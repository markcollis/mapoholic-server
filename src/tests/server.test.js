const expect = require('expect');
const request = require('supertest');
// const { ObjectID } = require('mongodb');

const { server } = require('../');
const User = require('../models/user');
require('../models/club');
// const Club = require('../models/club');
// const OEvent = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');

const {
  initUsers,
  initUserTokens,
  initClubs,
  // initOEvents,
  // initLinkedEvents,
  populateUsers, //           independent
  populateClubs, //           requires user_id
  // populateOEvents, //      requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
} = require('./seed');

beforeEach(populateUsers);
beforeEach(populateClubs);
// beforeEach(populateOEvents);
// beforeEach(populateLinkedEvents);

describe('POST /users/signup', () => {
  it('should create a new user', (done) => {
    const newUser = {
      email: 'new@user.com',
      password: 'passwordfornewuser',
    };
    request(server)
      .post('/users/signup')
      .send(newUser)
      .expect(200)
      .expect((res) => {
        expect(res.body.token).toBeTruthy();
      })
      .end((err) => {
        if (err) return done(err);
        // console.log('about to search for newUser');
        return User.find({ email: newUser.email }).then((users) => {
          // console.log(users);
          expect(users.length).toBe(1);
          expect(users[0].email).toBe('new@user.com');
          done();
        }).catch(e => done(e));
      });
  });
  it('should not create a user with invalid data', (done) => {
    const newUser = {
      email: 'anothernew@user.com',
      password: '1',
    };
    request(server)
      .post('/users/signup')
      .send(newUser)
      .expect(400)
      .end((err) => {
        if (err) return done(err);
        return User.find().then((users) => {
          expect(users.length).toBe(initUsers.length);
          done();
        }).catch(e => done(e));
      });
  });
  it('should not create a user if email is already in use', (done) => {
    const newUser = {
      email: initUsers[0].email,
      password: 'signedupalready',
    };
    request(server)
      .post('/users/signup')
      .send(newUser)
      .expect(400)
      .end((err) => {
        if (err) return done(err);
        return User.find().then((users) => {
          expect(users.length).toBe(initUsers.length);
          done();
        }).catch(e => done(e));
      });
  });
});

describe('POST /users/login', () => {
  it('should login user and return auth token', (done) => {
    request(server)
      .post('/users/login')
      .send({
        email: initUsers[0].email,
        password: initUsers[0].password,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.token).toBeTruthy();
      })
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });
  it('should reject an invalid login (bad password)', (done) => {
    request(server)
      .post('/users/login')
      .send({
        email: initUsers[0].email,
        password: 'wrongpassword',
      })
      .expect(401)
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });
  it('should reject an invalid login (nonexistent user)', (done) => {
    request(server)
      .post('/users/login')
      .send({
        email: 'wrong@wrong.com',
        password: 'wrongpassword',
      })
      .expect(401)
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });
});

// retrieve a list of all users (ids) matching specified criteria
describe('GET /users', () => {
  it('should list all users if called by an admin user', (done) => {
    request(server)
      .get('/users')
      .set('Authorization', `bearer ${initUserTokens[0]}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(initUsers.length);
      })
      .end(done);
  });
  it('should list only the correct users selected using query string parameters', (done) => {
    request(server)
      .get('/users?DisplayName=User&location=forest')
      .set('Authorization', `bearer ${initUserTokens[0]}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(1);
        expect(res.body[0].user_id).toBe(initUsers[0]._id.toString());
      })
      .end(() => {
        request(server)
          .get(`/users?memberOf=${initClubs[0]._id}`)
          .set('Authorization', `bearer ${initUserTokens[0]}`)
          .expect(200)
          .expect((res) => {
            // console.log('res.body:', res.body);
            expect(res.body.length).toBe(2);
            expect(res.body[0].user_id).toBe(initUsers[0]._id.toString());
            expect(res.body[1].user_id).toBe(initUsers[3]._id.toString());
          })
          .end(done);
      });
  });
  it('should list only self/public/all/relevant club users to a guest/std user', (done) => {
    request(server)
      .get('/users')
      .set('Authorization', `bearer ${initUserTokens[3]}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(3);
      })
      .end(done);
  });
  it('should return an empty array (not 404) if no users match the criteria', (done) => {
    request(server)
      .get('/users?fullName=NotRegisteredYet')
      .set('Authorization', `bearer ${initUserTokens[0]}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(0);
      })
      .end(done);
  });
  it('should reject a request without an authorization header', (done) => {
    request(server)
      .get('/users')
      .expect(401)
      .expect((res) => {
        // console.log('res.error:', res.error);
        expect(res.error.text).toBe('Unauthorized');
      })
      .end(done);
  });
  it('should reject a request with an invalid token', (done) => {
    request(server)
      .get('/users')
      .set('Authorization', 'bearer token1234')
      .expect(401)
      .expect((res) => {
        // console.log('res.error:', res.error);
        expect(res.error.text).toBe('Unauthorized');
      })
      .end(done);
  });
});

// retrieve a list of all publicly visible users (ids) matching specified criteria
describe('GET /users/public', () => {
  it('should list all users with visibility set to public', (done) => {
    request(server)
      .get('/users/public')
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(1);
        expect(res.body[0].user_id).toBe(initUsers[2]._id.toString());
      })
      .end(done);
  });
  it('should list only the correct users selected using query string parameters', (done) => {
    request(server)
      .get('/users/public?DisplayName=Guest')
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(1);
        expect(res.body[0].user_id).toBe(initUsers[2]._id.toString());
      })
      .end(done);
  });
  it('should return an empty array (not 404) if no users match the criteria', (done) => {
    request(server)
      .get('/users/public?fullName=NotRegisteredYet')
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body.length).toBe(0);
      })
      .end(done);
  });
  it('should ignore any bearer token and not check its validity', (done) => {
    request(server)
      .get('/users/public')
      .set('Authorization', 'bearer token1234')
      .expect(200)
      .expect((res) => {
        expect(res.body.length).toBe(1);
      })
      .end(done);
  });
});

// retrieve full details for the currently logged in user
describe('GET /users/me', () => {
  it('should return the user details corresponding to the header bearer token', (done) => {
    request(server)
      .get('/users/me')
      .set('Authorization', `bearer ${initUserTokens[0]}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body._id).toBe(initUsers[0]._id.toString());
      })
      .end(done);
  });
  it('should reject a request without an authorization header', (done) => {
    request(server)
      .get('/users/me')
      .expect(401)
      .expect((res) => {
        // console.log('res.error:', res.error);
        expect(res.error.text).toBe('Unauthorized');
      })
      .end(done);
  });
  it('should reject a request with an invalid token', (done) => {
    request(server)
      .get('/users/me')
      .set('Authorization', 'bearer token1234')
      .expect(401)
      .expect((res) => {
        // console.log('res.error:', res.error);
        expect(res.error.text).toBe('Unauthorized');
      })
      .end(done);
  });
});

// retrieve full details for the specified user
describe('GET /users/:id', () => {
  it('should return the user details matching the specified user id', (done) => {
    request(server)
      .get(`/users/${initUsers[0]._id.toString()}`)
      .set('Authorization', `bearer ${initUserTokens[3]}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body._id).toBe(initUsers[0]._id.toString());
      })
      .end(done);
  });
  it('should reject the request if the user doesn\'t have sufficient permissions', (done) => {
    request(server)
      .get(`/users/${initUsers[1]._id.toString()}`)
      .set('Authorization', `bearer ${initUserTokens[3]}`)
      .expect(400)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body._id).toBeFalsy();
      })
      .end(done);
  });
  it('should reject a request without an authorization header', (done) => {
    request(server)
      .get('/users/me')
      .expect(401)
      .expect((res) => {
        // console.log('res.error:', res.error);
        expect(res.error.text).toBe('Unauthorized');
      })
      .end(done);
  });
  it('should reject a request with an invalid token', (done) => {
    request(server)
      .get('/users/me')
      .set('Authorization', 'bearer token1234')
      .expect(401)
      .expect((res) => {
        // console.log('res.error:', res.error);
        expect(res.error.text).toBe('Unauthorized');
      })
      .end(done);
  });
});

// retrieve full details for the specified user if public
describe('GET /users/public/:id', () => {
  it('should return the user details matching the specified user id', (done) => {
    request(server)
      .get(`/users/public/${initUsers[2]._id.toString()}`)
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body._id).toBe(initUsers[2]._id.toString());
      })
      .end(done);
  });
  it('should reject the request if the specified user profile is not public', (done) => {
    request(server)
      .get(`/users/public/${initUsers[0]._id.toString()}`)
      .expect(400)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body._id).toBeFalsy();
      })
      .end(done);
  });
  it('should ignore any bearer token and not check its validity', (done) => {
    request(server)
      .get(`/users/public/${initUsers[2]._id.toString()}`)
      .set('Authorization', 'bearer token1234')
      .expect(200)
      .expect((res) => {
        // console.log('res.body:', res.body);
        expect(res.body._id).toBe(initUsers[2]._id.toString());
      })
      .end(done);
  });
});

// update the specified user (multiple amendment not supported)
describe('PATCH /users/:id', () => {});

// delete the specified user (multiple deletion not supported)
describe('DELETE /users/:id', () => {});

// create a club
describe('POST /clubs', () => {});
// retrieve a list of all clubs (ids) matching specified criteria
describe('GET /clubs', () => {});
// retrieve full details for the specified club
describe('GET /clubs/:id', () => {});
// update the specified club (multiple amendment not supported)
describe('PATCH /clubs/:id', () => {});
// delete the specified club (multiple deletion not supported)
describe('DELETE /clubs/:id', () => {});


// *** all cases below this line are for reference only and do not relate to this app ***

describe('POST /todo', () => {
  // it('should create a new todo', (done) => {
  //   const text = 'Test text for todo';
  //   request(app)
  //     .post('/todo')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({ text })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.text).toBe(text);
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find({ text }).then((todos) => {
  //         expect(todos.length).toBe(1);
  //         expect(todos[0].text).toBe(text);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should not create a todo with invalid data', (done) => {
  //   request(app)
  //     .post('/todo')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({})
  //     .expect(400)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('GET /todos', () => {
  // it('should get all todos associated with authenticated user', (done) => {
  //   request(app)
  //     .get('/todos')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todos.length).toBe(1);
  //     })
  //     .end(done);
  // });
});

describe('GET /todo/:id', () => {
  // it('should return the correct todo', (done) => {
  //   request(app)
  //     .get(`/todo/${initTodos[0]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe(initTodos[0].text);
  //     })
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to an invalid ID', (done) => {
  //   request(app)
  //     .get('/todo/3971904874890')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to a valid but absent ID', (done) => {
  //   const testId = new ObjectID();
  //   request(app)
  //     .get(`/todo/${testId.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 401 error if created by a different user', (done) => {
  //   request(app)
  //     .get(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(401)
  //     .end(done);
  // });
});

describe('DELETE /todo/:id', () => {
  // it('should remove the correct todo', (done) => {
  //   request(app)
  //     .delete(`/todo/${initTodos[0]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe(initTodos[0].text);
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(1);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should respond with a 404 error to an invalid ID', (done) => {
  //   request(app)
  //     .delete('/todo/3971904874890')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should repond with a 404 error to a valid but absent ID', (done) => {
  //   const testId = new ObjectID();
  //   request(app)
  //     .delete(`/todo/${testId.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should repond with a 401 error if not the creator', (done) => {
  //   request(app)
  //     .delete(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(401)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('PATCH /todo/:id', () => {
  // it('should update the correct todo and set a completedAt time', (done) => {
  //   request(app)
  //     .patch(`/todo/${initTodos[0]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({
  //       text: 'something different',
  //       completed: true,
  //     })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe('something different');
  //       expect(res.body.todo.completed).toBe(true);
  //       expect(typeof res.body.todo.completedAt).toBe('number');
  //     })
  //     .end(done);
  // });
  //
  // it('should update the correct todo and clear the completedAt time', (done) => {
  //   request(app)
  //     .patch(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[1].tokens[0].token)
  //     .send({
  //       text: 'something else different',
  //       completed: false,
  //     })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe('something else different');
  //       expect(res.body.todo.completed).toBe(false);
  //       expect(res.body.todo.completedAt).toBe(null);
  //     })
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to an invalid ID', (done) => {
  //   request(app)
  //     .patch('/todo/3971904874890')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to a valid but absent ID', (done) => {
  //   const testId = new ObjectID();
  //   request(app)
  //     .patch(`/todo/${testId.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 401 error if not the creator', (done) => {
  //   request(app)
  //     .patch(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({
  //       text: 'something else different',
  //       completed: false,
  //     })
  //     .expect(401)
  //     .end(done);
  // });
});

describe('POST /user', () => {
  // it('should create a new user', (done) => {
  //   const newUser = {
  //     email: 'new@user.com',
  //     password: 'passwordfornewuser',
  //   };
  //   request(app)
  //     .post('/user')
  //     .send(newUser)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body._id).toBeTruthy();
  //       expect(res.body.email).toBe(newUser.email);
  //       const headerAuth = res.header['x-auth'];
  //       User.findOne({ _id: res.body._id }).then((user) => {
  //         expect(headerAuth).toBe(user.tokens[0].token);
  //       });
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.find({ email: newUser.email }).then((users) => {
  //         expect(users.length).toBe(1);
  //         expect(users[0].email).toBe('new@user.com');
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should not create a user with invalid data', (done) => {
  //   const newUser = {
  //     email: 'anothernew@user.com',
  //     password: '123',
  //   };
  //   request(app)
  //     .post('/user')
  //     .send(newUser)
  //     .expect(400)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.find().then((users) => {
  //         expect(users.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should not create a user if email is already in use', (done) => {
  //   const newUser = {
  //     email: 'mark@example.com',
  //     password: 'I have signed up already',
  //   };
  //   request(app)
  //     .post('/user')
  //     .send(newUser)
  //     .expect(400)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.find().then((users) => {
  //         expect(users.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('GET /user/me', () => {
  // it('should retrieve details of the currently authenticated user', (done) => {
  //   request(app)
  //     .get('/user/me')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.email).toBe(initUsers[0].email);
  //     })
  //     .end(done);
  // });
  //
  // it('should return a 401 status if not authenticated', (done) => {
  //   request(app)
  //     .get('/user/me')
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.text).toBe('Authentication failed.');
  //       expect(res.body).toEqual({});
  //     })
  //     .end(done);
  // });
  //
  // it('should return a 401 status if auth token valid but user not found', (done) => {
  //   request(app)
  //     .get('/user/me')
  //     .set('x-auth', 'ey...64')
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.text).toBe('Authentication failed.');
  //       expect(res.body).toEqual({});
  //     })
  //     .end(done);
  // });
});

describe('POST /user/login', () => {
  // it('should login user and return auth token', (done) => {
  //   request(app)
  //     .post('/user/login')
  //     .send({
  //       email: initUsers[1].email,
  //       password: initUsers[1].password,
  //     })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.headers['x-auth']).toBeTruthy();
  //     })
  //     .end((err, res) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[1]._id).then((user) => {
  //         expect(user.tokens[1]).toHaveProperty('access', 'auth');
  //         expect(user.tokens[1]).toHaveProperty('token', res.headers['x-auth']);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should reject an invalid login (bad password)', (done) => {
  //   request(app)
  //     .post('/user/login')
  //     .send({
  //       email: initUsers[1].email,
  //       password: 'wrong',
  //     })
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.headers['x-auth']).toBeFalsy();
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[1]._id).then((user) => {
  //         expect(user.tokens.length).toBe(1);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should reject an invalid login (nonexistent user)', (done) => {
  //   request(app)
  //     .post('/user/login')
  //     .send({
  //       email: 'wrong@wrong.com',
  //       password: 'wrong',
  //     })
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.headers['x-auth']).toBeFalsy();
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[1]._id).then((user) => {
  //         expect(user.tokens.length).toBe(1);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('DELETE /user/me/token', () => {
  // it('should remove auth token on logout', (done) => {
  //   request(app)
  //     .delete('/user/me/token')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[0]._id).then((user) => {
  //         expect(user.tokens.length).toBe(0);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});
