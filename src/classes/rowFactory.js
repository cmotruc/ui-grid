﻿/// <reference path="../utils.js" />
/// <reference path="../namespace.js" />
/// <reference path="../../lib/angular.js" />
/// <reference path="../constants.js" />
ng.RowFactory = function(grid, $scope) {
    var self = this;
    // we cache rows when they are built, and then blow the cache away when sorting
    self.aggCache = {};
    self.parentCache = []; // Used for grouping and is cleared each time groups are calulated.
    self.dataChanged = true;
    self.parsedData = [];
    self.rowConfig = {};
    self.selectionService = $scope.selectionService;
    self.rowHeight = 30;
    self.numberOfAggregates = 0;
    self.groupedData = undefined;
    self.rowHeight = grid.config.rowHeight;
    self.rowConfig = {
        canSelectRows: grid.config.canSelectRows,
        rowClasses: grid.config.rowClasses,
        selectedItems: $scope.selectedItems,
        selectWithCheckboxOnly: grid.config.selectWithCheckboxOnly,
        beforeSelectionChangeCallback: grid.config.beforeSelectionChange,
        afterSelectionChangeCallback: grid.config.afterSelectionChange,
        jqueryUITheme: grid.config.jqueryUITheme,
        enableCellSelection: grid.config.enableCellSelection,
        rowHeight: grid.config.rowHeight
    };

    self.renderedRange = new ng.Range(0, grid.minRowsToRender() + EXCESS_ROWS);

    // @entity - the data item
    // @rowIndex - the index of the row
    self.buildEntityRow = function(entity, rowIndex) {
        // build the row
        return new ng.Row(entity, self.rowConfig, self.selectionService, rowIndex);
    };

    self.buildAggregateRow = function(aggEntity, rowIndex) {
        var agg = self.aggCache[aggEntity.aggIndex]; // first check to see if we've already built it 
        if (!agg) {
            // build the row
            agg = new ng.Aggregate(aggEntity, self, self.rowConfig, rowIndex);
            self.aggCache[aggEntity.aggIndex] = agg;
        }
        agg.rowIndex = rowIndex;
        agg.offsetTop = rowIndex * self.rowConfig.rowHeight;
        return agg;
    };
    self.UpdateViewableRange = function(newRange) {
        self.renderedRange = newRange;
        self.renderedChange();
    };
    self.filteredRowsChanged = function() {
        // check for latebound autogenerated columns
        if (grid.lateBoundColumns && grid.filteredRows.length > 0) {
            grid.config.columnDefs = undefined;
            grid.buildColumns();
            grid.lateBoundColumns = false;
        }
        self.dataChanged = true;
        if (grid.config.groups.length > 0) {
            self.getGrouping(grid.config.groups);
        }
        self.UpdateViewableRange(self.renderedRange);
    };

    self.renderedChange = function() {
        if (!self.groupedData || grid.config.groups.length < 1) {
            self.renderedChangeNoGroups();
            grid.refreshDomSizes();
            return;
        }
        self.wasGrouped = true;
        self.parentCache = [];
        var rowArr = [];
        var dataArray = self.parsedData.filter(function(e) {
            return e[NG_HIDDEN] === false;
        }).slice(self.renderedRange.topRow, self.renderedRange.bottomRow);
        angular.forEach(dataArray, function(item, indx) {
            var row;
            if (item.isAggRow) {
                row = self.buildAggregateRow(item, self.renderedRange.topRow + indx);
            } else {
                var i = self.renderedRange.topRow + indx;
                row = grid.rowCache[i];
                row.offsetTop = i * self.rowConfig.rowHeight;
                row.entity = item;
            }
            //add the row to our return array
            rowArr.push(row);
        });
        grid.setRenderedRows(rowArr);
    };

    self.renderedChangeNoGroups = function() {
        var rowArr = grid.filteredRows.slice(self.renderedRange.topRow, self.renderedRange.bottomRow);
        if (self.wasGrouped) {
            angular.forEach(grid.data, function (item, indx) {
                var row = grid.rowCache[indx];
                row.offsetTop = indx * self.rowConfig.rowHeight;
                row.entity = item;
            });
            self.wasGrouped = false;
        }
        grid.setRenderedRows(rowArr);
    };

    //magical recursion. it works. I swear it. I figured it out in the shower one day.
    self.parseGroupData = function(g) {
        if (g.values) {
            angular.forEach(g.values, function(item) {
                // get the last parent in the array because that's where our children want to be
                self.parentCache[self.parentCache.length - 1].children.push(item);
                //add the row to our return array
                self.parsedData.push(item);
            });
        } else {
            for (var prop in g) {
                // exclude the meta properties.
                if (prop == NG_FIELD || prop == NG_DEPTH || prop == NG_COLUMN) {
                    continue;
                } else if (g.hasOwnProperty(prop)) {
                    //build the aggregate row
                    var agg = self.buildAggregateRow({
                        gField: g[NG_FIELD],
                        gLabel: prop,
                        gDepth: g[NG_DEPTH],
                        isAggRow: true,
                        '_ng_hidden_': false,
                        children: [],
                        aggChildren: [],
                        aggIndex: self.numberOfAggregates,
                        aggLabelFilter: g[NG_COLUMN].aggLabelFilter
                    }, 0);
                    self.numberOfAggregates++;
                    //set the aggregate parent to the parent in the array that is one less deep.
                    agg.parent = self.parentCache[agg.depth - 1];
                    // if we have a parent, set the parent to not be collapsed and append the current agg to its children
                    if (agg.parent) {
                        agg.parent.collapsed = false;
                        agg.parent.aggChildren.push(agg);
                    }
                    // add the aggregate row to the parsed data.
                    self.parsedData.push(agg.entity);
                    // the current aggregate now the parent of the current depth
                    self.parentCache[agg.depth] = agg;
                    // dig deeper for more aggregates or children.
                    self.parseGroupData(g[prop]);
                }
            }
        }
    };
    //Shuffle the data into their respective groupings.
    self.getGrouping = function(groups) {
        self.aggCache = [];
        self.numberOfAggregates = 0;
        self.groupedData = {};
        // Here we set the onmousedown event handler to the header container.
        var rows = grid.filteredRows;
        var maxDepth = groups.length;
        var cols = $scope.columns;

        angular.forEach(rows, function (item) {
            var model = item.entity;
            model[NG_HIDDEN] = true;
            var ptr = self.groupedData;
            angular.forEach(groups, function(group, depth) {
                var col = cols.filter(function(c) {
                    return c.field == group;
                })[0];
                var val = ng.utils.evalProperty(model, group);
                val = val ? val.toString() : 'null';
                if (!ptr[val]) {
                    ptr[val] = {};
                }
                if (!ptr[NG_FIELD]) {
                    ptr[NG_FIELD] = group;
                }
                if (!ptr[NG_DEPTH]) {
                    ptr[NG_DEPTH] = depth;
                }
                if (!ptr[NG_COLUMN]) {
                    ptr[NG_COLUMN] = col;
                }
                ptr = ptr[val];
            });
            if (!ptr.values) {
                ptr.values = [];
            }
            ptr.values.push(model);
        });
		//moved out of above loops due to if no data initially, but has initial grouping, columns won't be added
		angular.forEach(groups, function(group, depth) {
			if (!cols[depth].isAggCol && depth <= maxDepth) {
				cols.splice(0, 0, new ng.Column({
					colDef: {
						field: '',
						width: 25,
						sortable: false,
						resizable: false,
						headerCellTemplate: '<div class="ngAggHeader"></div>'
					},
					isAggCol: true,
					headerRowHeight: grid.config.headerRowHeight
				}));
			}
		});
        grid.fixColumnIndexes();
        self.parsedData.length = 0;
        self.parseGroupData(self.groupedData);
    };

    if (grid.config.groups.length > 0 && grid.filteredRows.length > 0) {
        self.getGrouping(grid.config.groups);
    }
};