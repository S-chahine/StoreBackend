const express = require('express');
const app = express();
const port = process.env.PORT || 9000;
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const User = require('./userModel');
const session = require('express-session');
require('dotenv').config();


// Create a PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Use the DATABASE_URL environment variable
  ssl: {
    rejectUnauthorized: false, // For testing purposes, you might need to disable SSL rejection
  },
});

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

function generateOrderNumber() {
  const orderNumber = Math.floor(100000 + Math.random() * 900000);
  return orderNumber;
}

// Configure session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Define a route to retrieve all categories
app.get('/api/category', async (req, res) => {
  try {
    const client = await pool.connect();
    console.log(pool.connectionString);
    const result = await client.query('SELECT * FROM category');
    const categories = result.rows;

    client.release();
    res.json(categories);
  } catch (error) {
    console.error('Error retrieving categories:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Define a route to retrieve all products of a search query
app.get('/api/products', async (req, res) => {
  try {
    const { search } = req.query;

    // Perform the search query to retrieve products with matching titles
    const query = `
      SELECT *
      FROM product
      WHERE title ILIKE '%' || $1 || '%'
    `;
    const values = [search];
    const result = await pool.query(query, values);
    const products = result.rows;

    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).send('Internal Server Error');
  }
});


// Define a route to retrieve all products of a selected category
app.get('/api/products/:categoryId', async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM product WHERE category_id = $1', [categoryId]);
    const products = result.rows;
    client.release();
    res.json(products);
  } catch (error) {
    console.error('Error retrieving products:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Define a route to retrieve a specific product detail and its available sizes
app.get('/api/shop/product/:productId', async (req, res) => {
  try {
    const productId = req.params.productId;
    const client = await pool.connect();
    const productQuery = await client.query('SELECT * FROM product WHERE product_id = $1', [productId]);
    const product = productQuery.rows[0];
    const sizesQuery = await client.query('SELECT * FROM product_size WHERE product_id = $1', [productId]);
    const sizes = sizesQuery.rows;
    client.release();
    const productWithSizes = {
      ...product,
      sizes: sizes,
    };
    res.json(productWithSizes);
  } catch (error) {
    console.error('Error retrieving product details:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Middleware to retrieve the authenticated user ID from the session
const authenticateUser = (req, res, next) => {
  if (req.isAuthenticated()) {
    req.user = { id: req.session.passport.user };
  }
  next();
};

// Define the registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Validate form fields
    if (!firstName || !lastName || !email || !password) {
      res.status(400).json({ error: 'Invalid request. Please provide all the required fields.' });
      return;
    }

    // Hash the password using bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const createdAt = new Date();

    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO "user" (firstname, lastname, email, password, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [firstName, lastName, email, hashedPassword, createdAt]
    );

    const newUser = result.rows[0];

    client.release();

    res.status(201).json(newUser);
  } catch (error) {
    // Handle error
    if (error.response) {
      console.log('Registration error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.log('Registration error: Request made but no response received.');
    } else {
      console.log('Registration error:', error.message);
    }
  }
});

// Define the login endpoint
app.post('/api/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Error authenticating user:', err);
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    req.logIn(user, (err) => {
      if (err) {
        console.error('Error logging in user:', err);
        return next(err);
      }
      req.session.userId = user.userId;
      return res.json(user);
    });
  })(req, res, next);
});
// Define the dashboard API endpoints


app.put('/api/update', async (req, res) => {
  try {
    const userId = req.query.userId; // Use authenticated user ID from session
    const { firstname, lastname } = req.body;
    const client = await pool.connect();

    try {
      await client.query('UPDATE "user" SET firstname = $1, lastname = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3', [firstname, lastname, userId]);

      res.json({ message: 'User information updated successfully!' });
    } catch (error) {
      console.error('Error updating user information:', error);
      res.status(500).send('Internal Server Error');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error acquiring client from pool:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Update user email
app.put('/api/updateEmail', async (req, res) => {
  try {
    const { userId, password, email } = req.body;
    console.log('api/updateEmail -- called');

    const client = await pool.connect();

    try {
      const result = await client.query('SELECT * FROM "user" WHERE user_id = $1', [userId]);
      const user = result.rows[0];

      // Check if the current password provided by the user is valid
      if (!(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid current password' });
      }

      await client.query('UPDATE "user" SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [email, userId]);
      res.json({ message: 'Email updated successfully!' });
    } catch (error) {
      console.error('Error updating email:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error acquiring client from pool:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update user password
app.put('/api/updatePassword', async (req, res) => {
  try {
    const { userId, password, newPassword } = req.body;
    console.log('api/updatePassword -- called');
    // Hash the new password using bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const client = await pool.connect();
    try {
      // Retrieve the user from the database
      const result = await client.query('SELECT * FROM "user" WHERE user_id = $1', [userId]);
      const user = result.rows[0];
      // Check if the current password provided by the user is valid
      if (!(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid current password' });
      }
      // Update the user's password
      await client.query('UPDATE "user" SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [hashedPassword, userId]);
      res.json({ message: 'Password updated successfully!' });
    } catch (error) {
      console.error('Error updating password:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error acquiring client from pool:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API endpoint for fetching orders
app.get('/api/orders/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const client = await pool.connect();
    const query = `
    SELECT 
      "order".order_id,
      "order".order_number,
      "order".order_total,
      "order".status,
      "order".shipping_address,
      "order".payment_method,
      "order".subtotal,
      "order".taxamount,
      "order".created_at,
      order_item.price_per_unit,
      product.title AS item_title,
      product_size.size AS item_size
    FROM "order"
    JOIN order_item ON order_item.order_id = "order".order_id
    JOIN product ON product.product_id = order_item.product_id
    JOIN product_size ON product_size.product_size_id = order_item.size_id
    WHERE "order".user_id = $1
  `;
    const values = [userId];
    const result = await client.query(query, values);
    const orders = result.rows;
    client.release();

    res.json(orders);
  } catch (error) {
    console.error('Error retrieving orders:', error);
    res.status(500).send('Internal Server Error');
  }
});

// API endpoint for inserting order details
app.post('/api/orders', (req, res) => {
  const { user_id, status, shipping_address, payment_method, cartItems } = req.body;

  // Validate request body
  if (!user_id || !status || !shipping_address || !payment_method || !cartItems) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const orderNumber = generateOrderNumber();
  const taxRate = 0.13;

  // Calculate subtotal and tax amount for each cart item
  const cartItemsWithTotal = cartItems.map((item) => {
    const price = parseFloat(item.price_per_unit);
    const subtotal = (price * item.quantity).toFixed(2);
    const taxAmount = (price * item.quantity * taxRate).toFixed(2);

    return {
      ...item,
      subtotal,
      taxAmount,
    };
  });

  // Calculate overall subtotal and tax amount for the order
  const overallSubtotal = cartItemsWithTotal.reduce((total, item) => total + parseFloat(item.subtotal), 0);
  const overallTaxAmount = cartItemsWithTotal.reduce((total, item) => total + parseFloat(item.taxAmount), 0);

  const order_total = (parseFloat(overallSubtotal) + parseFloat(overallTaxAmount)).toFixed(2);

  const insertOrderQuery = `
    INSERT INTO "order" (user_id, order_total, status, shipping_address, payment_method, order_number, subtotal, taxamount, created_at)
    VALUES ($1, $2, $3, $4, $5, $6,$7,$8, NOW())
    RETURNING order_id, order_number
  `;

  const insertOrderValues = [
    user_id,
    parseFloat(order_total),
    status,
    shipping_address,
    payment_method,
    orderNumber,
    overallSubtotal,
    overallTaxAmount
  ];

  pool.query(insertOrderQuery, insertOrderValues)
    .then((orderResult) => {
      const orderId = orderResult.rows[0].order_id;
      const orderNumber = orderResult.rows[0].order_number;

      // Prepare order item data for insertion
      const orderItems = cartItemsWithTotal.map((item) => [
        orderId,
        item.product_id,
        item.size_id,
        item.quantity,
        parseFloat(item.price_per_unit).toFixed(2),
        new Date(),
      ]);

      // Insert order item details into the orderItem table
      const insertOrderItemsQuery = `
        INSERT INTO order_item (order_id, product_id, size_id, quantity, price_per_unit, created_at)
        VALUES ${orderItems.map((_, index) => `($${index * 6 + 1}, $${index * 6 + 2}, $${index * 6 + 3}, $${index * 6 + 4}, $${index * 6 + 5}, $${index * 6 + 6})`).join(', ')}
      `;

      // Flatten the orderItems array to match the number of parameters
      const insertOrderItemsValues = orderItems.flat();

      // Execute the query to insert order item details
      pool.query(insertOrderItemsQuery, insertOrderItemsValues)
        .then(() => {
          res.status(201).json({ orderId, orderNumber });
        })
        .catch((error) => {
          console.error('Error inserting order items:', error);
          res.status(500).json({ error: 'An error occurred while inserting order items.' });
        });
    })
    .catch((error) => {
      console.error('Error inserting order:', error);
      res.status(500).json({ error: 'An error occurred while inserting the order.' });
    });
});

// Apply the middleware to all routes
app.use(authenticateUser);

// Fetch user data
app.get('/api/user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;  // Use the authenticated user ID
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM "user" WHERE user_id = $1', [userId]);
    const user = result.rows[0];
    client.release();

    res.json(user);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send('Internal Server Error');
  }
});

//Fetch sizeId 
app.get('/api/size_id/:product_id/:selectedSize', async (req, res) => {
  try {
    const product_id = req.params.product_id;
    const selectedSize = req.params.selectedSize;
    const client = await pool.connect();
    const result = await client.query('SELECT product_size_id FROM product_size WHERE product_id = $1 AND size = $2', [product_id, selectedSize]);
    const sizeId = result.rows[0];

    client.release();

    res.json(sizeId);
  } catch (error) {
    console.error('Error fetching product size id:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Fetch available-quantity
app.get('/api/product_size/:productSizeId', async (req, res) => {
  console.log('Fetch available-quantity');
  try {
    const productSizeId = req.params.productSizeId;
    console.log(productSizeId);
    const client = await pool.connect();
    const result = await client.query('SELECT quantity_available FROM product_size WHERE product_size_id = $1', [productSizeId]);
    const quantity_available = result.rows[0];
    res.json(quantity_available);

    client.release();
  } catch (error) {
    console.error('Error fetching quantity:', error);
    res.status(500).send('Internal Server Error');
  }
});


//Update available-quantity
app.put('/api/product_size/:productSizeId', async (req, res) => {
  try {
    const productSizeId = req.params.productSizeId;
    const newQuantity = req.body.availableQuantity;
    const client = await pool.connect();
    await client.query('UPDATE product_size SET quantity_available = COALESCE($1, 0) WHERE product_size_id = $2', [newQuantity, productSizeId]);
    res.json({ message: 'Quantity updated successfully!' });
  } catch (error) {
    console.error('Error updating quantity', error);
    res.status(500).send('Internal Server Error');
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.response?.status || 500).json({ error: err.response?.data || 'Internal Server Error' });
});

// Configure Passport.js to use the LocalStrategy for authentication
passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM "user" WHERE email = $1', [email]);
        const user = result.rows[0];
        client.release();

        if (!user || !(await bcrypt.compare(password, user.password))) {
          return done(null, false);
        }

        return done(null, user);
      } catch (error) {
        console.error('Error authenticating user:', error);
        return done(error);
      }
    }
  )
);


// Serialize and deserialize user objects
passport.serializeUser((user, done) => {
  done(null, user.user_id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM "user" WHERE user_id = $1', [id]);
    const user = result.rows[0];
    client.release();

    done(null, user);
  } catch (error) {
    console.error('Error deserializing user:', error);
    done(error);
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
