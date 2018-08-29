'use strict';

(function() {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };

      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function(resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function(value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function(prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function() {
          return this[targetProp][prop];
        },
        set: function(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', [
    'name',
    'keyPath',
    'multiEntry',
    'unique'
  ]);

  proxyRequestMethods(Index, '_index', IDBIndex, [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, [
    'openCursor',
    'openKeyCursor'
  ]);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', [
    'direction',
    'key',
    'primaryKey',
    'value'
  ]);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
    'update',
    'delete'
  ]);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function() {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function() {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function(value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function() {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function() {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', [
    'name',
    'keyPath',
    'indexNames',
    'autoIncrement'
  ]);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'put',
    'add',
    'delete',
    'clear',
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'openCursor',
    'openKeyCursor'
  ]);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, [
    'deleteIndex'
  ]);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function(resolve, reject) {
      idbTransaction.oncomplete = function() {
        resolve();
      };
      idbTransaction.onerror = function() {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function() {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function() {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', [
    'objectStoreNames',
    'mode'
  ]);

  proxyMethods(Transaction, '_tx', IDBTransaction, [
    'abort'
  ]);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function() {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, [
    'deleteObjectStore',
    'close'
  ]);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function() {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(DB, '_db', IDBDatabase, [
    'close'
  ]);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
    [ObjectStore, Index].forEach(function(Constructor) {
      // Don't create iterateKeyCursor if openKeyCursor doesn't exist.
      if (!(funcName in Constructor.prototype)) return;

      Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function() {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function(Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function(query, count) {
      var instance = this;
      var items = [];

      return new Promise(function(resolve) {
        instance.iterateCursor(query, function(cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      if (request) {
        request.onupgradeneeded = function(event) {
          if (upgradeCallback) {
            upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
          }
        };
      }

      return p.then(function(db) {
        return new DB(db);
      });
    },
    delete: function(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
    module.exports.default = module.exports;
  }
  else {
    self.idb = exp;
  }
}());

const VERSION = 'v10';
const IDB_NAME = 'restaurants-' + VERSION;

/**
 * Common database helper functions.
 */
class DBHelper {

  /**
   * Database URL.
   * Change this to restaurants.json file location on your server.
   */
  static get DATABASE_URL() {
    const port = 1337 // Change this to your server port
    return `http://localhost:${port}/restaurants`;
  }

  /**
   * Reviews URL.
   */
  static get REVIEWS_URL() {
    const port = 1337 // Change this to your server port
    return `http://localhost:${port}/reviews`;
  }

  /**
   * Fetch all restaurants.
   */

  static fetchRestaurants(callback) {
    DBHelper.openIDB();
    fetch( DBHelper.DATABASE_URL )
    .then( response => response.json() )
    .then( function(json){
      DBHelper.cacheRestaurants(json);
      return callback(null,json);
    })
    .catch( function(error) {
      return DBHelper.getCacheRestaurants(callback);
    });
  }

  static cacheRestaurants(json){
    DBHelper.dbPromise.then(db => {
      const tx = db.transaction('restaurants', 'readwrite');
      const objectStore = tx.objectStore('restaurants');
      if( Array.isArray(json) ){
        json.forEach(function(restaurant){
          objectStore.put(restaurant);
        });
      }else{
        objectStore.put(json);
      }
      return tx.complete;
    });
  }

  static cacheReviews(restaurant_id, json){
    DBHelper.dbPromise.then(db => {
      const tx = db.transaction('reviews', 'readwrite');
      const objectStore = tx.objectStore('reviews');
      if( Array.isArray(json) ){
        json.forEach(function(review){
          objectStore.put(review);
        });
      }else{
        objectStore.put(json);
      }
      return tx.complete;
    });
  }

  static deleteCacheReview(review_id){
    DBHelper.dbPromise.then(db => {
      const tx = db.transaction('new-reviews', 'readwrite');
      const objectStore = tx.objectStore('new-reviews');
      objectStore.delete(review_id);
      return tx.complete;
    });
  }

  static saveReview(review, callback) {
    DBHelper.openIDB();
    DBHelper.dbPromise.then(db => {
      const tx = db.transaction('new-reviews', 'readwrite');
      const objectStore = tx.objectStore('new-reviews');
      objectStore.put(review);
      return callback(null, review);
    });
  }

  static getCacheRestaurants(callback){
    return DBHelper.dbPromise.then(db => {
      return db.transaction('restaurants', 'readwrite')
               .objectStore('restaurants').getAll();
    }).then( function(restaurants){
      return callback(null, restaurants);
    });
  }

  static getCacheRestaurant(restaurant_id, callback){
    return DBHelper.dbPromise.then(db => {
      return db.transaction('restaurants', 'readwrite')
               .objectStore('restaurants').get(parseInt(restaurant_id));
      }).then( function(restaurant){
        return callback(null, restaurant);
      });
  }

  static isFavoriteRestaurant(restaurant_id){
    return DBHelper.dbPromise.then(db => {
      return db.transaction('favorites', 'readwrite')
               .objectStore('favorites').get(parseInt(restaurant_id));
      }).then( function(restaurant){
        return restaurant.favorite;
      }).catch( function(error){
        return false;
      });
  }

  static saveFavoriteRestaurant(restaurant_id, isFavorite){
    const restaurant = {"restaurant_id": restaurant_id, "favorite": isFavorite };
    DBHelper.dbPromise.then(db => {
      const tx = db.transaction('favorites', 'readwrite');
      const objectStore = tx.objectStore('favorites');
      objectStore.put(restaurant);
    });
  }

  static getCacheReviews(restaurant_id, new_reviews, callback){
    let me = this;
    me.new_reviews = new_reviews;
    me.all_reviews = [];
    return DBHelper.dbPromise.then(db => {
      return db.transaction('reviews', 'readwrite')
               .objectStore('reviews').index('restaurant_id').getAll(parseInt(restaurant_id));
    }).then( function(restaurant_reviews){
      const all_reviews = new Array();
      me.all_reviews = all_reviews;
      DBHelper.mergeReviews(all_reviews, me.new_reviews, restaurant_reviews);

      return callback(null, all_reviews);
    })
    .catch( function(error) {
      return callback(null, me.all_reviews);
    });
  }

  static getCacheNewReviews(restaurant_id, callback){
    return DBHelper.dbPromise.then(db => {
      return db.transaction('new-reviews', 'readwrite')
               .objectStore('new-reviews').index('restaurant_id').getAll(parseInt(restaurant_id));
    }).then( function(restaurant_reviews){
      return restaurant_reviews;
    });
  }

  static openIDB(){
    if (!navigator.serviceWorker) {
      DBHelper.dbPromise = Promise.resolve();
    }
    DBHelper.dbPromise = idb.open(IDB_NAME, 2, upgradeDB => {
      upgradeDB.createObjectStore("restaurants", { keyPath: "id" });
      const reviewsStore = upgradeDB.createObjectStore("reviews", { keyPath: "id" });
      reviewsStore.createIndex('restaurant_id', 'restaurant_id');
      const newReviewsStore = upgradeDB.createObjectStore("new-reviews", { keyPath: "id", autoIncrement:true });
      newReviewsStore.createIndex('restaurant_id', 'restaurant_id');
      upgradeDB.createObjectStore("favorites", { keyPath: "restaurant_id" });
    });
  }

  /**
   * Fetch a restaurant by its ID.
   */
  static fetchRestaurantById(id, callback) {
    DBHelper.openIDB();
    fetch( `${DBHelper.DATABASE_URL}/${id}` )
    .then( response => response.json() )
    .then( function(json) {
      DBHelper.cacheRestaurants(json);
      return callback(null,json);
    })
    .catch( function(error) {
      return DBHelper.getCacheRestaurant(id, callback);
    });
  }

  static fetchReviewsByRestaurantId(restaurant_id, callback) {
    let me = this;
    DBHelper.getCacheNewReviews(restaurant_id).then( function(new_reviews) {
      me.new_reviews = new_reviews;
      return fetch( `${DBHelper.REVIEWS_URL}/?restaurant_id=${restaurant_id}` );
    })
    .then( response => response.json() )
    .then( function(json) {
      // Cache retrieved reviews
      DBHelper.cacheReviews(restaurant_id, json);

      const all_reviews = new Array();
      DBHelper.mergeReviews(all_reviews, me.new_reviews, json);
      DBHelper.postCacheNewReviews(me.new_reviews);

      return callback(null,all_reviews);
    })
    .catch( function(error) {
      return DBHelper.getCacheReviews(restaurant_id, me.new_reviews, callback);
    });
  }

  static mergeReviews(all_reviews, new_reviews, api_reviews){
    if( Array.isArray(api_reviews) ){
      api_reviews.forEach(function(api_review){
        all_reviews.push(api_review);
      });
    }else{
      all_reviews.push(api_reviews);
    }
    if( Array.isArray(new_reviews) ){
      new_reviews.forEach(function(new_review){
        all_reviews.push(new_review);
      });
    }else{
      all_reviews.push(new_reviews);
    }
  }

  static postCacheNewReviews(new_reviews){
    if( Array.isArray(new_reviews) ){
      new_reviews.forEach(function(new_review){
        DBHelper.postCacheNewReview(new_review);
      });
    }else{
      DBHelper.postCacheNewReview(new_reviews);
    }
  }

  static postCacheNewReview(new_review)
  {
    let me = this;
    me.new_review = new_review;
    me.new_review_id = new_review.id;
    new_review.id = null;
    fetch( `${DBHelper.REVIEWS_URL}/`,{
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(new_review)
    })
    .then( response => response.json() )
    .then( function(json){
      return DBHelper.deleteCacheReview(me.new_review_id);
    });
  }

  /**
   * Fetch restaurants by a cuisine type with proper error handling.
   */
  static fetchRestaurantByCuisine(cuisine, callback) {
    // Fetch all restaurants  with proper error handling
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Filter restaurants to have only given cuisine type
        const results = restaurants.filter(r => r.cuisine_type == cuisine);
        callback(null, results);
      }
    });
  }

  /**
   * Fetch restaurants by a neighborhood with proper error handling.
   */
  static fetchRestaurantByNeighborhood(neighborhood, callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Filter restaurants to have only given neighborhood
        const results = restaurants.filter(r => r.neighborhood == neighborhood);
        callback(null, results);
      }
    });
  }

  /**
   * Fetch restaurants by a cuisine and a neighborhood with proper error handling.
   */
  static fetchRestaurantByCuisineAndNeighborhood(cuisine, neighborhood, callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        let results = restaurants
        if (cuisine != 'all') { // filter by cuisine
          results = results.filter(r => r.cuisine_type == cuisine);
        }
        if (neighborhood != 'all') { // filter by neighborhood
          results = results.filter(r => r.neighborhood == neighborhood);
        }
        callback(null, results);
      }
    });
  }

  /**
   * Fetch all neighborhoods with proper error handling.
   */
  static fetchNeighborhoods(callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Get all neighborhoods from all restaurants
        const neighborhoods = restaurants.map((v, i) => restaurants[i].neighborhood)
        // Remove duplicates from neighborhoods
        const uniqueNeighborhoods = neighborhoods.filter((v, i) => neighborhoods.indexOf(v) == i)
        callback(null, uniqueNeighborhoods);
      }
    });
  }

  /**
   * Fetch all cuisines with proper error handling.
   */
  static fetchCuisines(callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Get all cuisines from all restaurants
        const cuisines = restaurants.map((v, i) => restaurants[i].cuisine_type)
        // Remove duplicates from cuisines
        const uniqueCuisines = cuisines.filter((v, i) => cuisines.indexOf(v) == i)
        callback(null, uniqueCuisines);
      }
    });
  }

  /**
   * Restaurant page URL.
   */
  static urlForRestaurant(restaurant) {
    return (`./restaurant.html?id=${restaurant.id}`);
  }

  /**
   * Restaurant image URL.
   */
  static imageUrlForRestaurant(restaurant) {
    return (`/img/${restaurant.photograph}.jpg`);
  }

  /**
   * Map marker for a restaurant.
   */
  static mapMarkerForRestaurant(restaurant, map) {
    if( typeof google !== 'undefined' && google && google.maps && google.maps.Marker ){} else return null;

    const marker = new google.maps.Marker({
      position: restaurant.latlng,
      title: restaurant.name,
      url: DBHelper.urlForRestaurant(restaurant),
      map: map,
      animation: google.maps.Animation.DROP}
    );
    return marker;
  }

}
