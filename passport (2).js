import { use, serializeUser, deserializeUser } from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { compare } from 'bcrypt';

import { findOne, findById } from './userModel'; // Replace with your User model import

use(
  new LocalStrategy({ usernameField: 'email', passwordField: 'password'}, async (email, password, done) => {
    try {
      const user = await findOne({ email });
      console.log({email});
      if (!user || !(await compare(password, user.password))) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  })
);

serializeUser((user, done) => {
  done(null, user.id);
});

deserializeUser(async (id, done) => {
  try {
    const user = await findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});
