let restaurant;
var map;

/**
 * Initialize Google map, called from HTML.
 */
window.initMap = () => {
  fetchRestaurantFromURL((error, restaurant) => {
    if (error) { // Got an error!
      console.error(error);
    } else {
      self.map = new google.maps.Map(document.getElementById('map'), {
        zoom: 16,
        center: restaurant.latlng,
        scrollwheel: false
      });
      fillBreadcrumb();
      DBHelper.mapMarkerForRestaurant(self.restaurant, self.map);
      google.maps.event.addListener(self.map, "tilesloaded", function() {
        setTimeout(disableGoogleMapsFocus, 1000)
      });
    }
  });
}

/**
 * Get current restaurant from page URL.
 */
fetchRestaurantFromURL = (callback) => {
  if (self.restaurant) { // restaurant already fetched!
    callback(null, self.restaurant)
    return;
  }
  const id = getParameterByName('id');
  if (!id) { // no id found in URL
    error = 'No restaurant id in URL';
    callback(error, null);
  } else {
    DBHelper.fetchRestaurantById(id, (error, restaurant) => {
      self.restaurant = restaurant;
      if (!restaurant) {
        console.error(error);
        return;
      }
      DBHelper.fetchReviewsByRestaurantId(id, (error, reviews) => {
        restaurant.reviews = reviews;
        fillRestaurantHTML();
        callback(null, restaurant);
      });
    });
  }
}

/**
 * Create restaurant HTML and add it to the webpage
 */
fillRestaurantHTML = (restaurant = self.restaurant) => {
  const me = this;
  const name = document.getElementById('restaurant-name');
  me.name = name;
  me.restaurant = restaurant;
  name.innerHTML = restaurant.name;
  DBHelper.isFavoriteRestaurant(restaurant).then(
    function(isFavorite){
      const name = document.getElementById('restaurant-name');
      let link = "<a aria-label='Favorite'" +
                 " style='text-decoration: none; color: black; cursor: pointer'" +
                 " onclick='return toogleFavorite();'" +
                 (isFavorite ? " selected" : "") +
                 " >" +
                 (isFavorite ? "&#9733;" : "&#9734;") + "</a> "
      name.innerHTML = link + me.restaurant.name;
    })
    .catch(function(error){
    });

  const address = document.getElementById('restaurant-address');
  address.innerHTML = restaurant.address;

  const image = document.getElementById('restaurant-img');
  image.className = 'restaurant-img';
  image.alt = "Image of " + restaurant.name + " Restaurant";
  image.src = DBHelper.imageUrlForRestaurant(restaurant);

  const cuisine = document.getElementById('restaurant-cuisine');
  cuisine.innerHTML = restaurant.cuisine_type;

  // fill operating hours
  if (restaurant.operating_hours) {
    fillRestaurantHoursHTML();
  }
  // fill reviews
  fillReviewsHTML();
}

/**
 * Create restaurant operating hours HTML table and add it to the webpage.
 */
fillRestaurantHoursHTML = (operatingHours = self.restaurant.operating_hours) => {
  const hours = document.getElementById('restaurant-hours');
  for (let key in operatingHours) {
    const row = document.createElement('tr');

    const day = document.createElement('td');
    day.innerHTML = key;
    row.appendChild(day);

    const time = document.createElement('td');
    time.innerHTML = operatingHours[key];
    row.appendChild(time);

    hours.appendChild(row);
  }
}

/**
 * Create all reviews HTML and add them to the webpage.
 */
fillReviewsHTML = (reviews = self.restaurant.reviews) => {
  const container = document.getElementById('reviews-container');

  if (!reviews) {
    return;
  }
  const ul = document.getElementById('reviews-list');
  ul.innerHTML = "";
  reviews.forEach(review => {
    ul.appendChild(createReviewHTML(review));
  });
  container.appendChild(ul);
}

/**
 * Create review HTML and add it to the webpage.
 */
createReviewHTML = (review) => {
  const li = document.createElement('li');
  const div_title =  document.createElement('div');
  div_title.classList.add("reviews-title")
  li.appendChild(div_title);

  const name = document.createElement('p');
  name.innerHTML = review.name;
  name.classList.add("reviews-name")
  div_title.appendChild(name);

  const date = document.createElement('p');
  const d = new Date(review.updatedAt);
  date.innerHTML = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
  date.classList.add("reviews-date")
  div_title.appendChild(date);

  const div_info =  document.createElement('div');
  div_info.classList.add("reviews-info")
  li.appendChild(div_info);

  const rating = document.createElement('p');
  rating.innerHTML = `Rating: ${review.rating}`;
  div_info.appendChild(rating);
  rating.classList.add("reviews-rating")

  const comments = document.createElement('p');
  comments.innerHTML = review.comments;
  div_info.appendChild(comments);

  return li;
}

/**
 * Add restaurant name to the breadcrumb navigation menu
 */
fillBreadcrumb = (restaurant=self.restaurant) => {
  const breadcrumb = document.getElementById('breadcrumb');
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.appendChild(document.createTextNode(restaurant.name));
  a.setAttribute("href", "/restaurant.html?id=" + restaurant.id);
  a.setAttribute("aria-current", "page");
  li.appendChild(a);

  breadcrumb.appendChild(li);
}

/**
 * Get a parameter by name from page URL.
 */
getParameterByName = (name, url) => {
  if (!url)
    url = window.location.href;
  name = name.replace(/[\[\]]/g, '\\$&');
  const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`),
    results = regex.exec(url);
  if (!results)
    return null;
  if (!results[2])
    return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

disableGoogleMapsFocus = () => {
  document.querySelectorAll('#map a').forEach(function(item) {
      item.setAttribute('tabindex','-1');
  });
  document.querySelectorAll('#map button').forEach(function(item) {
      item.setAttribute('tabindex','-1');
  });
  document.querySelectorAll('#map div').forEach(function(item) {
      item.setAttribute('tabindex','-1');
  });
}

saveReview = () => {
  const r_name = document.getElementById('name').value;
  const r_rating = document.getElementById('rating').value;
  const r_comments = document.getElementById('comments').value;
  var d = new Date();

  const review = {name: r_name,
    rating: parseInt(r_rating),
    comments: r_comments,
    restaurant_id: self.restaurant.id,
    updatedAt: Date.now()
  };
  DBHelper.saveReview(review, saveReviewCallback);
}

saveReviewCallback = (error, review) => {
  location.reload();
}

toogleFavorite = () => {
  const name = document.getElementById('restaurant-name');
  const isFavorite = !name.innerHTML.includes("selected");
  DBHelper.saveFavoriteRestaurant(self.restaurant.id, isFavorite);

  let link = "<a aria-label='Favorite'" +
                 " style='text-decoration: none; color: black; cursor: pointer'" +
                 " onclick='return toogleFavorite();'" +
                 (isFavorite ? " selected" : "") +
                 " >" +
                 (isFavorite ? "&#9733;" : "&#9734;") + "</a> "
  name.innerHTML = link + self.restaurant.name;
  return false;
}


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(function() {
  }, function() {
  });
}
