//#region Copyright, Version, and Description
/*
 * Copyright 2015 IdeaBlade, Inc.  All Rights Reserved.
 * Use, reproduction, distribution, and modification of this code is subject to the terms and
 * conditions of the IdeaBlade Breeze license, available at http://www.breezejs.com/license
 *
 * Author: Ward Bell
 * Version: 0.9.4
 * --------------------------------------------------------------------------------
 * Adds getEntityGraph method to Breeze EntityManager and EntityManager prototype
 * Source:
 * https://github.com/Breeze/breeze.js.labs/blob/master/breeze.getEntityGraph.js
 *
 * Depends on Breeze which it patches
 *
 * For discussion, see:
 * http://www.breezejs.com/documentation/getentitygraph
 *
 * For example usage, see:
 * https://github.com/Breeze/breeze.js.samples/tree/master/net/DocCode/DocCode/tests/getEntityGraphTests.js
 */
//#endregion
(function (definition) {
  if (typeof breeze === "object") {
    definition(breeze);
  } else if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
    // CommonJS or Node
    var b = require('breeze');
    definition(b);
  } else if (typeof define === "function" && define["amd"]) {
    // Requirejs / AMD
    define(['breeze'], definition);
  } else {
    throw new Error("Can't find breeze");
  }
}(function (breeze) {
  'use strict';

  var EntityManager = breeze.EntityManager;
  var proto = EntityManager.prototype;

  if (!EntityManager.getEntityGraph) {
    /**
    Get related entities of root entity (or root entities) as specified by expand.
    @example
        var graph = breeze.EntityManager.getEntityGraph(customer, 'Orders.OrderDetails');
        // graph will be the customer, all of its orders and their details even if deleted.
    @method getEntityGraph
    @param roots {Entity|Array of Entity} The root entity or root entities.
    @param expand {String|Array of String|Object} an expand string, a query expand clause, or array of string paths
    @return {Array of Entity} root entities and their related entities, including deleted entities. Duplicates are removed and entity order is indeterminate.
    **/
    EntityManager.getEntityGraph = getEntityGraphCore;
  }

  if (!proto.getEntityGraph) {
    /**
    Execute query locally and return both the query results and their related entities as specified by the optional expand parameter or the query's expand clause.
    @example
        var query = breeze.EntityQuery.from('Customers')
                    .where('CompanyName', 'startsWith', 'Alfred')
                    .expand('Orders.OrderDetails');
        var graph = manager.getEntityGraph(query);
        // graph will be the 'Alfred' customers, their orders and their details even if deleted.
    @method getEntityGraph
    @param query {EntityQuery} A query to be executed against the manager's local cache.
    @param [expand] {String|Array of String|Object} an expand string, a query expand clause, or array of string paths
    @return {Array of Entity} local queried root entities and their related entities, including deleted entities. Duplicates are removed and entity order is indeterminate.
    **/

    /**
    Get related entities of root entity (or root entities) as specified by expand.
    @example
        var graph = manager.getEntityGraph(customer, 'Orders.OrderDetails');
        // graph will be the customer, all of its orders and their details even if deleted.
    @method getEntityGraph
    @param roots {Entity|Array of Entity} The root entity or root entities.
    @param expand {String|Array of String|Object} an expand string, a query expand clause, or array of string paths
    @return {Array of Entity} root entities and their related entities, including deleted entities. Duplicates are removed and entity order is indeterminate.
    **/
    proto.getEntityGraph = getEntityGraph;
  }

  function getEntityGraph(roots, expand) {
    if (roots instanceof breeze.EntityQuery) {
      var newRoots = this.executeQueryLocally(roots);
      return getEntityGraphCore(newRoots, expand || roots.expandClause);
    } else {
      return getEntityGraphCore(roots, expand);
    }
  }

  function getEntityGraphCore(roots, expand) {
    var entityGroupMap, graph = [], rootType;
    roots = Array.isArray(roots) ? roots : [roots];
    addToGraph(roots);     // removes dups & nulls
    roots = graph.slice(); // copy of de-duped roots
    if (roots.length) {
      getRootInfo();
      getExpand();
      buildGraph();
    }
    return graph;

    function addToGraph(entities) {
      entities.forEach(function (entity) {
        if (entity && graph.indexOf(entity) < 0) {
          graph.push(entity);
        }
      });
    }

    function getRootInfo() {
      var compatTypes;

      roots.forEach(function (root, ix) {
        var aspect;
        if (!root || !(aspect = root.entityAspect)) {
          throw getRootErr(ix, 'is not an entity');
        }
        if (aspect.entityState === breeze.EntityState.Detached) {
          throw getRootErr(ix, 'is a detached entity');
        }

        var em = aspect.entityManager;
        if (entityGroupMap) {
          if (entityGroupMap !== em._entityGroupMap) {
            throw getRootErr(ix, "has a different 'EntityManager' than other roots");
          }
        } else {
          entityGroupMap = em._entityGroupMap;
        }
        getRootType(root, ix);

      });

      function getRootErr(ix, msg) {
        return new Error("'getEntityGraph' root[" + ix + "] " + msg);
      };

      function getRootType(root, ix) {
        var thisType = root.entityType;
        if (!rootType) {
          rootType = thisType;
          return;
        } else if (rootType === thisType) {
          return;
        }
        // Types differs. Look for closest common base type
        // does thisType derive from current rootType?
        var baseType = rootType;
        do {
          compatTypes = compatTypes || baseType.getSelfAndSubtypes();
          if (compatTypes.indexOf(thisType) > -1) {
            rootType = baseType;
            return;
          }
          baseType = baseType.baseEntityType;
          compatTypes = null;
        } while (baseType);

        // does current rootType derives from thisType?
        baseType = thisType;
        do {
          compatTypes = baseType.getSelfAndSubtypes();
          if (compatTypes.indexOf(rootType) > -1) {
            rootType = baseType;
            return;
          }
          baseType = baseType.baseEntityType;
        } while (baseType)

        throw getRootErr(ix, "is not EntityType-compatible with other roots");
      }
    }

    function getExpand() {
      try {
        if (!expand) {
          expand = [];
        } else if (typeof expand === 'string') {
          // tricky because Breeze expandClause not exposed publically
          expand = new breeze.EntityQuery().expand(expand).expandClause;
        }
        if (expand.propertyPaths) { // expand clause
          expand = expand.propertyPaths;
        } else if (Array.isArray(expand)) {
          if (!expand.every(function (elem) { return typeof elem === 'string'; })) {
            throw '';
          }
        } else {
          throw '';
        }
      } catch (_) {
        throw new Error(
            "expand must be an expand string, array of string paths, or a query expand clause");
      }
    }

    function buildGraph() {
      if (expand && expand.length) {
        var fns = expand.map(makePathFn);
        fns.forEach(function (fn) { fn(roots); });
      }
    }

    // Make function to get entities along a single expand path
    // such as 'Orders.OrderDetails.Product'
    function makePathFn(path) {
      var fns = [],
          segments = path.split('.'),
          type = rootType;

      for (var i = 0, slen = segments.length; i < slen; i++) {
        var f = makePathSegmentFn(type, segments[i]);
        type = f.navType;
        fns.push(f);
      }

      return function pathFn(entities) {
        for (var j = 0, flen = fns.length; j < flen; j++) {
          var elen = entities.length;
          if (elen === 0) { return; } // nothing left to explore
          // fn to get related entities for this path segment
          var fn = fns[j];
          // get entities related by this path segment
          var related = [];
          for (var k = 0; k < elen; k++) {
            related = related.concat(fn(entities[k]));
          }
          addToGraph(related);
          if (j >= flen - 1) { return; } // no more path segments

          // reset entities to deduped related entities
          entities = [];
          for (var l = 0, rlen = related.length; l < rlen; l++) {
            var r = related[l];
            if (entities.indexOf(r) < 0) { entities.push(r); }
          }
        }
      };
    }

    // Make function to get entities along a single expand path segment
    // such as the 'OrderDetails' in the 'Orders.OrderDetails.Product' path
    function makePathSegmentFn(baseType, segment) {
      var baseTypeName, fn = undefined, navType;
      try {
        baseTypeName = baseType.name;
        var nav = baseType.getNavigationProperty(segment);
        var fkName = nav.foreignKeyNames[0];
        if (!nav) {
          throw new Error(segment + " is not a navigation property of " + baseTypeName);
        }
        navType = nav.entityType;
        // add derived types
        var navTypes = navType.getSelfAndSubtypes();
        var grps = []; // non-empty groups for these types
        navTypes.forEach(function (t) {
          var grp = entityGroupMap[t.name];
          if (grp && grp._entities.length > 0) {
            grps.push(grp);
          }
        });
        var grpCount = grps.length;
        if (grpCount === 0) {
          // no related entities in cache
          fn = function () { return []; };
        } else if (fkName) {
          fn = function (entity) {
            var val = null;
            try {
              var keyValue = entity.getProperty(fkName);
              for (var i = 0; i < grpCount; i += 1) {
                val = grps[i]._entities[grps[i]._indexMap[keyValue]];
                if (val) { break; }
              }
            } catch (e) { rethrow(e); }
            return val;
          };
        } else {
          fkName = nav.inverse ?
             nav.inverse.foreignKeyNames[0] :
             nav.invForeignKeyNames[0];
          if (!fkName) { throw new Error("No inverse keys"); }
          fn = function (entity) {
            var vals = [];
            try {
              var keyValue = entity.entityAspect.getKey().values[0];
              grps.forEach(function (grp) {
                vals = vals.concat(grp._entities.filter(function (en) {
                  return en && en.getProperty(fkName) === keyValue;
                }));
              });
            } catch (e) { rethrow(e); }
            return vals;
          };
        }
        fn.navType = navType;
        fn.path = segment;

      } catch (err) { rethrow(err); }
      return fn;

      function rethrow(e) {
        var typeName = baseTypeName || baseType;
        var error = new Error("'getEntityGraph' can't expand '" + segment + "' for " + typeName);
        error.innerError = e;
        throw error;
      }
    }
  }

}));
