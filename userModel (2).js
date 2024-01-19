const { compare } = require('bcrypt');
const { Pool } = require('pg');

// Create a new Pool instance with your database connection details
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'store',
  password: 'Pa55w.rd',
  port: 5432, // The default port for PostgreSQL
});

const User = {};

User.authenticate = async function (email, password) {
  const user = users.find((user) => user.email === email);

  if (!user) {
    return false;
  }

  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    return false;
  }

  return user;
};
// Custom method to verify user password
User.verifyPassword = async function (password) {
  return await compare(password, this.password);
};

// Method to find a user by email
User.findOne = async function (email) {
  const query = 'SELECT * FROM "user" WHERE email = $1';
  const values = [email];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    throw error;
  }
};

// Method to find a user by ID
User.findById = async function (id) {
  const query = 'SELECT * FROM "user" WHERE id = $1';
  const values = [id];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    throw error;
  }
};

module.exports = User;