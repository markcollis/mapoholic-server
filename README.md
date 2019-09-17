![logo](mapoholicLogoSmall.jpg)

# MapOholic (server)

MapOholic is an online database designed to make it easy to keep track of collections of orienteering maps, together with associated routes, results, and other related information.

This repository contains the code for the back end of the application, built with [Node](https://nodejs.org), [Express](https://expressjs.com) and [MongoDB](https://www.mongodb.com). The code for the front end can be found in the related repository [markcollis/mapoholic-client](https://github.com/markcollis/mapoholic-client).

Full details about what MapOholic does and why can be found in the README for the front end. This document defines the API that supports it and provides practical information about installing and running it yourself.

## Architecture

The overall architecture of MapOholic is summarised in the following diagram.

![architecture](mapoholicArchitecture.png)

This repository contains the code that runs on Node.js in the API server. It is structured as follows:
 * Routes: direct incoming API requests to the relevant controller.
 * Controllers: validate the API request, call on services to process the request, then respond accordingly to the client.
 * Services: access resources in the database or filesystem or manipulate data.
 * Models: define the data model and mediate access to the database.

All textual data, including image paths, is stored in a remote MongoDB database. The images themselves are stored on, and served from, the local filesystem.

## Data models

There are five Mongoose models, with appropriate cross-referencing between them, which define users, clubs, events, linked groups of events and a record of significant actions.

The pivotal model is that representing an event, which is organised by one or more clubs, and attended by a number of runners (users), each of whom can upload a number of maps. See the [models]('https://github.com/markcollis/mapoholic-server/tree/master/src/models') folder for full definitions.

Image files are stored on the local filesystem, with their path being stored in the database. Before being processed, image files are written to /images/upload. Profile images are then stored in /images/avatars as a file named after the relevant userId. The more numerous map images are stored in /images/maps in directories named after the relevant eventId.

Server logs are also written to the local filesystem (in /logs) but are not considered to be part of the data model as they are never read or processed subsequently by the application.

## API

The API provides the following endpoints. Authentication is token-based, requests requiring authentication are clearly marked. Some actions will only be successful for a user with appropriate permissions.

### Users

#### Public:
<hr>

**POST** /users { email, password, displayName? }
<br>Create a user account
<br>Response: auth token (JWT)

```
curl -d 'email=example@example.com&password=password' http://localhost:3090/users
```
```
{
  "token":"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg"
}
```
<hr>

**POST** /users/login { email, password }
<br>Log in to an existing user account
<br>Response: auth token (JWT)

```
curl -d 'email=example@example.com&password=newPassword' http://localhost:3090/users/login
```
```
{
  "token":"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1Njg0NTQ3OTQ3Njh9.wtUbVHuQ6AN94eY94s0C0nmc8aShLxvuIVx5BvtrJus"
}
```
<hr>

**GET** /users/public[?displayName=, fullName=, regNumber=, location=, about=, memberOf=, role=]
<br>Retrieve a list of all users, matching specified criteria if provided
<br>Response: array of user objects with summary details (JSON)

```
curl http://localhost:3090/users/public
```
```
[
  {
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "role":"standard",
    "visibility":"public",
    "fullName":"",
    "regNumber":"",
    "orisId":"",
    "location":"",
    "about":"\"I am an example.\"",
    "memberOf":[],
    "profileImage":"",
    "email":"example@example.com",
    "displayName":"example@example.com",
    "createdAt":"2019-09-13T08:44:35.929Z",
    "updatedAt":"2019-09-13T08:44:35.929Z"
  },
  {...}
]
```
<hr>

**GET** /users/public/:id
<br>Retrieve full details for the specified user
<br>Response: user object with full details (JSON)

```
curl http://localhost:3090/users/public/5d7b56f3da12cb4cae3ecb00
```
```
{
  "_id":"5d7b56f3da12cb4cae3ecb00",
  "role":"standard",
  "visibility":"all",
  "fullName":"",
  "regNumber":"",
  "orisId":"",
  "location":"",
  "about":"",
  "memberOf":[],
  "profileImage":"",
  "email":"example@example.com",
  "displayName":"example@example.com",
  "createdAt":"2019-09-13T08:44:35.929Z",
  "updatedAt":"2019-09-13T08:44:35.929Z"
}
```
<hr>

#### Requiring authentication:
<hr>

**POST** /users/:id/password { currentPassword, newPassword }
<br>Reset password of specified user
<br>Response: success message

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'currentPassword=password&newPassword=newPassword' http://localhost:3090/users/5d7b56f3da12cb4cae3ecb00/password
```
```
{
  "status":"Password changed successfully."
}
```
<hr>

**POST** /users/:id/profileImage {{+upload: image file}}
<br>Upload profile image for specified user
<br>Response: URL for uploaded profile image

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -H 'Content-Type: multipart/form-data' -F 'upload=@pic.jpg' -X POST http://localhost:3090/users/5d7b56f3da12cb4cae3ecb00/profileImage
```
```plain
http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg
```
<hr>

**GET** /users[?displayName=, fullName=, regNumber=, location=, about=, memberOf=, role=]
<br>Retrieve a list of all users, matching specified criteria if provided
<br>Response: array of user objects with summary details (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/users
```
```
[
  {
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "role":"standard",
    "visibility":"public",
    "fullName":"",
    "regNumber":"",
    "orisId":"",
    "location":"",
    "about":"\"I am an example.\"",
    "memberOf":[],
    "profileImage":"",
    "email":"example@example.com",
    "displayName":"example@example.com",
    "createdAt":"2019-09-13T08:44:35.929Z",
    "updatedAt":"2019-09-13T08:44:35.929Z"
  },
  {...}
]
```
<hr>

**GET** /users/me
<br>Retrieve full details for the currently logged in user
<br>Response: user object with full details (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/users/me
```
```
{
  "_id":"5d7b56f3da12cb4cae3ecb00",
  "role":"standard",
  "visibility":"all",
  "fullName":"",
  "regNumber":"",
  "orisId":"",
  "location":"",
  "about":"",
  "memberOf":[],
  "profileImage":"",
  "email":"example@example.com",
  "displayName":"example@example.com",
  "createdAt":"2019-09-13T08:44:35.929Z",
  "updatedAt":"2019-09-13T08:44:35.929Z"
}
```
<hr>

**GET** /users/:id
<br>Retrieve full details for the specified user
<br>Response: user object with full details (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/users/5d7b56f3da12cb4cae3ecb00
```
```
{
  "_id":"5d7b56f3da12cb4cae3ecb00",
  "role":"standard",
  "visibility":"all",
  "fullName":"",
  "regNumber":"",
  "orisId":"",
  "location":"",
  "about":"",
  "memberOf":[],
  "profileImage":"",
  "email":"example@example.com",
  "displayName":"example@example.com",
  "createdAt":"2019-09-13T08:44:35.929Z",
  "updatedAt":"2019-09-13T08:44:35.929Z"
}
```
<hr>

**PATCH** /users/:id { displayName?, fullName?, regNumber?, location?, about?, contact?, memberOf?, email?, visibility? }
<br>Update the specified user
<br>Response: updated user object with full details (JSON)

```
curl -X PATCH -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'visibility=public&about="I am an example."' http://localhost:3090/users/5d7b56f3da12cb4cae3ecb00
```
```
{
  "_id":"5d7b56f3da12cb4cae3ecb00",
  "role":"standard",
  "visibility":"public",
  "fullName":"",
  "regNumber":"",
  "orisId":"",
  "location":"",
  "about":"\"I am an example.\"",
  "memberOf":[],
  "profileImage":"",
  "email":"example@example.com",
  "displayName":"example@example.com",
  "createdAt":"2019-09-13T08:44:35.929Z",
  "updatedAt":"2019-09-13T08:44:35.929Z"
}
```
<hr>

**DELETE** /users/:id
<br>Delete the specified user
<br>Response: Deleted user object with full details (JSON)

```
curl -X DELETE -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/users/5d7b56f3da12cb4cae3ecb00
```
```
{
  "_id":"5d7b56f3da12cb4cae3ecb00",
  "role":"standard",
  "visibility":"public",
  "fullName":"",
  "regNumber":"DKP7703",
  "orisId":"37633",
  "location":"",
  "about":"\"I am an example.\"",
  "memberOf":[],
  "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
  "active":false,
  "email":"deleted1568454865446example@example.com",
  "displayName":"example@example.com deleted:14092019@1154",
  "createdAt":"2019-09-13T08:44:35.929Z",
  "updatedAt":"2019-09-14T09:54:25.449Z"
}
```
<hr>

**DELETE** /users/:id/profileImage
<br>Delete profile image of the specified user
<br>Response: success message

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/users/5d7b56f3da12cb4cae3ecb00/profileImage
```
```
{
  "status":"Profile image deleted from example@example.com by example@example.com."
}
```
<hr>

### Clubs

#### Public:
<hr>

**GET** /clubs[?shortName=, fullName=, orisId=, country=, website=, owner=]
<br>Retrieve a list of all clubs, matching specified criteria if provided
<br>Response: array of club objects (JSON)

```
curl http://localhost:3090/clubs

```
```
[
  {
    "_id":"5d7b671cda12cb4cae3ecb05",
    "fullName":"Oddíl OB Kotlářka",
    "orisId":"27",
    "owner": {
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "displayName":"example@example.com"
    },
    "shortName":"DKP",
    "country":"CZE",
    "website":"http://obkotlarka.cz/",
    "createdAt":"2019-09-13T09:53:32.046Z",
    "updatedAt":"2019-09-13T09:53:32.046Z",
  },
  {...}
]
```
<hr>

#### Requiring authentication:
<hr>

**POST** /clubs { shortName, fullName?, country?, website? }
<br>Create a club (attempting to automatically populate missing details for Czech clubs from their abbreviation via ORIS)
<br>Response: created club object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'shortName=DKP&country=CZE'  http://localhost:3090/clubs
```
```
{
  "fullName":"Oddíl OB Kotlářka",
  "orisId":"27",
  "active":true,
  "_id":"5d7b671cda12cb4cae3ecb05",
  "owner": {
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "shortName":"DKP",
  "country":"CZE",
  "website":"http://obkotlarka.cz/",
  "createdAt":"2019-09-13T09:53:32.046Z",
  "updatedAt":"2019-09-13T09:53:32.046Z",
}
```
<hr>

**PATCH** /clubs/:id { shortName?, fullName?, country?, website? }
<br>Update the specified club (attempting to automatically populate missing details for Czech clubs via ORIS)
<br>Response: updated club object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'website=https://obkotlarka.cz' -X PATCH http://localhost:3090/clubs/5d7b671cda12cb4cae3ecb05
```
```
{
  "_id":"5d7b671cda12cb4cae3ecb05",
  "fullName":"Oddíl OB Kotlářka",
  "orisId":"27",
  "owner": {
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "shortName":"DKP",
  "country":"CZE",
  "website":"https://obkotlarka.cz/",
  "createdAt":"2019-09-13T09:53:32.046Z",
  "updatedAt":"2019-09-13T09:53:32.046Z",
}
```
<hr>

**DELETE** /clubs/:id
<br>Delete the specified club
<br>Response: deleted club object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/clubs/5d7b671cda12cb4cae3ecb05
```
```
{
  "fullName":"Oddíl OB Kotlářka",
  "orisId":"27",
  "active": false,
  "_id":"5d7b671cda12cb4cae3ecb05",
  "owner": {
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "shortName":"DKP deleted:13092019@1426",
  "country":"CZE",
  "website":"https://obkotlarka.cz/",
  "createdAt":"2019-09-13T09:53:32.046Z",
  "updatedAt":"2019-09-13T12:26:30.511Z",
},
```
<hr>

### Events

#### Public:
<hr>

**GET** /events/public

```
curl http://localhost:3090/events/public
```
```
[
  {
    "_id":"5d7bc03180fba060b7306359",
    "date":"2019-09-14",
    "name":"\"Example Trophy 2019\"",
    "locPlace":"Utopia",
    "locCornerSW":[],
    "locCornerNW":[],
    "locCornerNE":[],
    "locCornerSE":[],
    "organisedBy":[],
    "linkedTo":[],
    "types":[],
    "tags":[],
    "runners":[
      {
        "user":"5d7b56f3da12cb4cae3ecb00",
        "displayName":"example@example.com",
        "numberMaps":0,
        "mapExtract":null,
        "tags":[]}
    ]
  },
  {...}
]
```
<hr>

**GET** /events/:eventid/public

```
curl http://localhost:3090/events/5d7bc03180fba060b7306359/public
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{"_id":"5d7b56f3da12cb4cae3ecb00","displayName":"example@example.com"},
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "active":true,
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[],
    "comments":[]
  }],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-13T16:27:27.330Z"
}
```
<hr>

#### Requiring authentication:
<hr>

**POST** /events { name, date, mapName?, locPlace?, locRegions?, locCountry?, locLat?, locLong?, locCornerNW?, locCornerNE?, locCornerSW?, locCornerSE?, orisId?, types?, tags?, website?, results?, organisedBy?, linkedTo? }
<br>Create an event
<br>Response: created event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'name="Example Trophy 2019"&date=2019-09-14&locPlace=Utopia&organisedBy=5d7bb10a17ce0670050a415d' http://localhost:3090/events
```
```
{
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "active":true,
  "_id":"5d7bc03180fba060b7306359",
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-13T16:13:37.860Z",
}
```
<hr>

**POST** /events/oris/:oriseventid
<br>Create a new event using ORIS API data for *ORIS event id*
<br>Response: created event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X POST http://localhost:3090/events/oris/4739
```
```
{
  "organisedBy":[{
    "_id":"5cf11d454245b2113ddbd03c",
    "shortName":"KAM"
  }],
  "linkedTo":[],
  "locRegions":["Č"],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":["Middle"],
  "tags":["Žebříček B"],
  "active":true,
  "_id":"5d7bc2b980fba060b730635b",
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "date":"2019-09-08",
  "name":"Žebříček B-Čechy západ",
  "orisId":"4739",
  "mapName":"1 : 10 000, E = 5 m, stav srpen 2019, ISOM 2017, vodovzdorně upravená",
  "locPlace":"Kamenice, osada Těptín",
  "locCountry":"CZE",
  "locLat":49.889,
  "locLong":14.5655,
  "website":"https://oris.orientacnisporty.cz/Zavod?id=4739",
  "results":"https://oris.orientacnisporty.cz/Vysledky?id=4739",
  "runners":[],
  "createdAt":"2019-09-13T16:24:25.545Z",
  "updatedAt":"2019-09-13T16:24:25.545Z",
}
```
<hr>

**POST** /events/:eventid/maps
<br>Add the current user as a runner to the specified event
<br>Response: updated event object with new runner added (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X POST http://localhost:3090/events/5d7bc03180fba060b7306359/maps
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"",
      "orisId":"",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[],
    "comments":[]
  }],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-13T16:27:27.330Z"
}
```
<hr>

**POST** /events/:eventid/oris
<br>Add the current user as a runner to the specified event, populating course details and results by calling the ORIS API
<br>Response: updated event object with new runner added (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X POST http://localhost:3090/events/5d7bc2b980fba060b730635b/oris
```
*\*example@example.com has borrowed my ORIS user id here to demonstrate auto-populate*
```
{
  "_id":"5d7bc2b980fba060b730635b",
  "organisedBy":[{"_id":"5cf11d454245b2113ddbd03c","shortName":"KAM"}],
  "linkedTo":[],
  "locRegions":["Č"],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":["Middle"],
  "tags":["Žebříček B"],
  "owner":{"_id":"5d7b56f3da12cb4cae3ecb00","displayName":"example@example.com"},
  "date":"2019-09-08",
  "name":"Žebříček B-Čechy západ",
  "orisId":"4739",
  "mapName":"1 : 10 000, E = 5 m, stav srpen 2019, ISOM 2017, vodovzdorně upravená",
  "locPlace":"Kamenice, osada Těptín",
  "locCountry":"CZE",
  "locLat":49.889,
  "locLong":14.5655,
  "website":"https://oris.orientacnisporty.cz/Zavod?id=4739",
  "results":"https://oris.orientacnisporty.cz/Vysledky?id=4739",
  "runners":[{
    "visibility":"public",
    "tags":[],
    "_id":"5d7bc45d80fba060b7306360",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "displayName":"example@example.com"
    },
    "courseTitle":"H40B",
    "courseLength":"4.51",
    "courseClimb":"60",
    "courseControls":"22",
    "time":"42:45",
    "place":"9.",
    "timeBehind":"+ 7:48",
    "fieldSize":"31",
    "fullResults":[
      {"_id":"5d7bc45d80fba060b730637f","place":"1.","sort":"1","name":"Nehasil David","regNumber":"BOR7713","clubShort":"BOR","club":"OK Jiskra Nový Bor","time":"34:57","loss":""},
      {"_id":"5d7bc45d80fba060b730637e","place":"2.","sort":"2","name":"Novák Ivo","regNumber":"OKP6200","clubShort":"OKP","club":"SK OK 24 Praha","time":"35:55","loss":"+ 0:58"},
      {"_id":"5d7bc45d80fba060b730637d","place":"3.","sort":"3","name":"Gregor Martin","regNumber":"DKP7705","clubShort":"DKP","club":"Oddíl OB Kotlářka","time":"36:09","loss":"+ 1:12"},
      {"_id":"5d7bc45d80fba060b730637c","place":"4.","sort":"4","name":"Pachner Pavel","regNumber":"CHA7501","clubShort":"CHA","club":"OK Chrastava","time":"37:50","loss":"+ 2:53"},
      {"_id":"5d7bc45d80fba060b730637b","place":"5.","sort":"5","name":"Nemšovský Petr","regNumber":"PGP7602","clubShort":"PGP","club":"SK Praga","time":"39:26","loss":"+ 4:29"},
      {"_id":"5d7bc45d80fba060b730637a","place":"6.","sort":"6","name":"Ječmen Vladimír","regNumber":"ONO7900","clubShort":"ONO","club":"SKOB Ostrov","time":"39:54","loss":"+ 4:57"},
      {"_id":"5d7bc45d80fba060b7306379","place":"7.","sort":"7","name":"Šunka Jan","regNumber":"LOU7600","clubShort":"LOU","club":"SK Moravan Louňovice","time":"40:22","loss":"+ 5:25"},
      {"_id":"5d7bc45d80fba060b7306378","place":"8.","sort":"8","name":"Hřivna Štěpán","regNumber":"PGP7507","clubShort":"PGP","club":"SK Praga","time":"42:41","loss":"+ 7:44"},
      {"_id":"5d7bc45d80fba060b7306377","place":"9.","sort":"9","name":"Collis Mark","regNumber":"DKP7703","clubShort":"DKP","club":"Oddíl OB Kotlářka","time":"42:45","loss":"+ 7:48"},
      {"_id":"5d7bc45d80fba060b7306376","place":"10.","sort":"10","name":"Synek Antonín","regNumber":"DOK7800","clubShort":"DOK","club":"OK Doksy","time":"44:05","loss":"+ 9:08"},
      {"_id":"5d7bc45d80fba060b7306375","place":"11.","sort":"11","name":"Štembera Jan","regNumber":"TJN7513","clubShort":"TJN","club":"OOB TJ Tatran Jablonec n. N.","time":"44:37","loss":"+ 9:40"},
      {"_id":"5d7bc45d80fba060b7306374","place":"12.","sort":"12","name":"Sychra Zdeněk","regNumber":"CHA7302","clubShort":"CHA","club":"OK Chrastava","time":"46:11","loss":"+ 11:14"},
      {"_id":"5d7bc45d80fba060b7306373","place":"13.","sort":"13","name":"Patka Miroslav","regNumber":"BOR7715","clubShort":"BOR","club":"OK Jiskra Nový Bor","time":"46:19","loss":"+ 11:22"},
      {"_id":"5d7bc45d80fba060b7306372","place":"14.","sort":"14","name":"Vilém Stanislav","regNumber":"VLI7703","clubShort":"VLI","club":"Slavia Liberec orienteering","time":"46:30","loss":"+ 11:33"},
      {"_id":"5d7bc45d80fba060b7306371","place":"15.","sort":"15","name":"Rod Jan","regNumber":"VSP7423","clubShort":"VSP","club":"USK Praha","time":"46:34","loss":"+ 11:37"},
      {"_id":"5d7bc45d80fba060b7306370","place":"16.","sort":"16","name":"Nejedlý Ladislav","regNumber":"ONO7501","clubShort":"ONO","club":"SKOB Ostrov","time":"47:21","loss":"+ 12:24"},
      {"_id":"5d7bc45d80fba060b730636f","place":"17.","sort":"17","name":"Střelba Ondřej","regNumber":"PGP7510","clubShort":"PGP","club":"SK Praga","time":"48:19","loss":"+ 13:22"},
      {"_id":"5d7bc45d80fba060b730636e","place":"18.","sort":"18","name":"Černý Michal","regNumber":"ROU7505","clubShort":"ROU","club":"SKOB Roudnice nad Labem","time":"48:37","loss":"+ 13:40"},
      {"_id":"5d7bc45d80fba060b730636d","place":"19.","sort":"19","name":"Kožíšek Petr","regNumber":"LPM7603","clubShort":"LPM","club":"OK Lokomotiva Plzeň","time":"48:46","loss":"+ 13:49"},
      {"_id":"5d7bc45d80fba060b730636c","place":"20.","sort":"20","name":"Heller Jiří","regNumber":"ROU7708","clubShort":"ROU","club":"SKOB Roudnice nad Labem","time":"49:47","loss":"+ 14:50"},
      {"_id":"5d7bc45d80fba060b730636b","place":"21.","sort":"21","name":"Březina Jan","regNumber":"CHA7604","clubShort":"CHA","club":"OK Chrastava","time":"50:46","loss":"+ 15:49"},
      {"_id":"5d7bc45d80fba060b730636a","place":"22.","sort":"22","name":"Foršt Jakub","regNumber":"DOR7501","clubShort":"DOR","club":"OK Dobříš","time":"51:45","loss":"+ 16:48"},
      {"_id":"5d7bc45d80fba060b7306369","place":"23.","sort":"23","name":"Kolář David","regNumber":"LOU7700","clubShort":"LOU","club":"SK Moravan Louňovice","time":"52:03","loss":"+ 17:06"},
      {"_id":"5d7bc45d80fba060b7306368","place":"24.","sort":"24","name":"Řehák Miroslav","regNumber":"SKV7101","clubShort":"SKV","club":"TJ Slovan Karlovy Vary","time":"52:07","loss":"+ 17:10"},
      {"_id":"5d7bc45d80fba060b7306367","place":"25.","sort":"25","name":"Lacina Martin","regNumber":"DKP7502","clubShort":"DKP","club":"Oddíl OB Kotlářka","time":"58:58","loss":"+ 24:01"},
      {"_id":"5d7bc45d80fba060b7306366","place":"26.","sort":"26","name":"Končický Lukáš","regNumber":"RIC7501","clubShort":"RIC","club":"OB Říčany","time":"59:17","loss":"+ 24:20"},
      {"_id":"5d7bc45d80fba060b7306365","place":"27.","sort":"27","name":"Houska Jindřich","regNumber":"DOR7601","clubShort":"DOR","club":"OK Dobříš","time":"59:37","loss":"+ 24:40"},
      {"_id":"5d7bc45d80fba060b7306364","place":"28.","sort":"28","name":"Kubát Tomáš","regNumber":"RIC7503","clubShort":"RIC","club":"OB Říčany","time":"60:42","loss":"+ 25:45"},
      {"_id":"5d7bc45d80fba060b7306363","place":"29.","sort":"29","name":"Fiala Jan","regNumber":"DOR7802","clubShort":"DOR","club":"OK Dobříš","time":"62:30","loss":"+ 27:33"},
      {"_id":"5d7bc45d80fba060b7306362","place":"30.","sort":"30","name":"Pávek Jiří","regNumber":"NEK7700","clubShort":"NEK","club":"Nejdek Orienteering","time":"67:54","loss":"+ 32:57"},
      {"_id":"5d7bc45d80fba060b7306361","place":"31.","sort":"31","name":"Havel Josef","regNumber":"KNC7800","clubShort":"KNC","club":"Sokol Kostelec n. Č. l.","time":"73:57","loss":"+ 39:00"}
    ],
  "maps":[],
  "comments":[]
  }],
  "createdAt":"2019-09-13T16:24:25.545Z",
  "updatedAt":"2019-09-13T16:31:25.214Z"
}
```
<hr>

**POST** /events/:eventid/maps/:userid/:maptype(course|route)/:maptitle? {{ +upload: image file }}
<br>Upload a scanned map for the specified runner to the specified event; either course or route must be specified as the type of map, while the optional maptitle is the label to use for each part of multi-part map sets
<br>Response: updated event object with new map reference added (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -H 'Content-Type: multipart/form-data' -F 'upload=@map.jpg' -X POST http://localhost:3090/events/5d7bc03180fba060b7306359/maps/5d7b56f3da12cb4cae3ecb00/course
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "active":true,
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[{
      "geo":{
        "track":[]
      },
      "title":"",
      "isGeocoded":false,
      "_id":"5d7bed6180fba060b7306384",
      "course":"http://localhost:3090/images/maps/5d7bc03180fba060b7306359/5d7b56f3da12cb4cae3ecb00-map-course.jpg",
      "courseUpdated":"1568402785621",
      "route":"",
      "overlay":""
    }],
    "comments":[],
    "courseTitle":"Long"
  }],
"createdAt":"2019-09-13T16:13:37.860Z",
"updatedAt":"2019-09-13T19:26:25.622Z",
"mapName":"\"The Enchanted Forest\""
}
```
<hr>

**POST** /events/:eventid/comments/:userid { text }
<br>Post a new comment against the specified runner's map in the specified event
<br>Response: updated comments object (JSON) *[not complete event]*

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'text="This is an insightful comment."' http://localhost:3090/events/5d7bc03180fba060b7306359/comments/5d7b56f3da12cb4cae3ecb00
```
```
[{
  "_id":"5d7bf5a60f55ee69d7338393",
  "author":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "fullName":"",
    "regNumber":"DKP7703",
    "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
    "displayName":"example@example.com"
  },
  "text":"\"This is an insightful comment.\"",
  "postedAt":"2019-09-13T20:01:42.995Z",
  "updatedAt":"2019-09-13T20:01:42.995Z"
}]
```
<hr>

**GET** /events[?date=, name=, orisId=, mapName=, locName=, locPlace=, locRegions=, locCountry=, types=, tags=, website=, results=, owner=, organisedBy=, linkedTo=, runners=, locLat=, locLong=]
<br>Retrieve a list of all events, matching specified criteria if provided [may include events without *maps* visible to the current user]
<br>Response: array of event objects with summary details (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/events?date=2019-09
```
```
[
  {
    "_id":"5d7bc03180fba060b7306359",
    "date":"2019-09-14",
    "name":"\"Example Trophy 2019\"",
    "locPlace":"Utopia",
    "locCornerSW":[],
    "locCornerNW":[],
    "locCornerNE":[],
    "locCornerSE":[],
    "organisedBy":[],
    "linkedTo":[],
    "types":[],
    "tags":[],
    "runners":[
      {
        "user":"5d7b56f3da12cb4cae3ecb00",
        "displayName":"example@example.com",
        "numberMaps":0,
        "mapExtract":null,
        "tags":[]}
    ]
  },
  {...}
]
```
<hr>

**GET** /events/:eventid
<br>Retrieve full details for the specified event
<br>Response: event object with full details (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/events/5d7bc03180fba060b7306359
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{"_id":"5d7b56f3da12cb4cae3ecb00","displayName":"example@example.com"},
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "active":true,
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[],
    "comments":[]
  }],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-13T16:27:27.330Z"
}
```
<hr>

**GET** /events/oris[?datefrom=, dateto]
<br>Retrieve a list of all events in ORIS that the current user has entered (to be used to provide a list to select from before calling POST /events/oris/:oriseventid)
<br>Response: array of ORIS event details (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/events/oris?datefrom=2019-09-01
```
*\*example@example.com has borrowed my ORIS user id here*
```
[{
  "orisEntryId":"1448517","orisClassId":"113068","orisEventId":"4738","date":"2019-09-07","class":"H40B","name":"Žebříček B-Čechy západ","place":"Krhanice, Dolní Požáry"},
  {"orisEntryId":"1448518","orisClassId":"113104","orisEventId":"4739","date":"2019-09-08","class":"H40B","name":"Žebříček B-Čechy západ","place":"Kamenice, osada Těptín"},
  {"orisEntryId":"1472676","orisClassId":"113632","orisEventId":"5406","date":"2019-09-26","class":"T3","name":"Podvečerní O-běh Folimankou","place":"Sportovní hala USK Folimanka, Praha 2"}]
```
<hr>

**PATCH** /events/:eventid { name?, date?, mapName?, locPlace?, locRegions?, locCountry?, locLat?, locLong?, locCornerNW?, locCornerNE?, locCornerSW?, locCornerSE?, types?, tags?, website?, results?, organisedBy?, linkedTo? }
<br>Update the specified event
<br>Response: updated event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'mapName="The Enchanted Forest"' -X PATCH http://localhost:3090/events/5d7bc03180fba060b7306359
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "active":true,
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[],
    "comments":[]
  }],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-13T19:07:23.283Z",
  "mapName":"\"The Enchanted Forest\""
}
```
<hr>

**PATCH** /events/:eventid/maps/:userid { visibility?, courseTitle?, courseLength?, courseClimb?, courseControls?, fullResults?, time?, place?, timeBehind?, fieldSize?, distanceRun?, tags? }
<br>Update the specified runner and map data
<br>Response: updated event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'courseTitle=Long' -X PATCH http://localhost:3090/events/5d7bc03180fba060b7306359/maps/5d7b56f3da12cb4cae3ecb00
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "active":true,
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[],
    "comments":[],
    "courseTitle":"Long"
  }],
"createdAt":"2019-09-13T16:13:37.860Z",
"updatedAt":"2019-09-13T19:20:03.197Z",
"mapName":"\"The Enchanted Forest\""
}
```
<hr>

**PATCH** /events/:eventid/comments/:userid/:commentid { text}
<br>Edit the specified comment
<br>Response: updated comments object (JSON) *[not complete event]*

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'text="This is an insightful comment, which has now been updated"' -X PATCH http://localhost:3090/events/5d7bc03180fba060b7306359/comments/5d7b56f3da12cb4cae3ecb00/5d7bf5a60f55ee69d7338393
```
```
[{
  "_id":"5d7bf5a60f55ee69d7338393",
  "author":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "fullName":"",
    "regNumber":"DKP7703",
    "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
    "displayName":"example@example.com"
  },
  "text":"\"This is an insightful comment, which has now been updated.\"",
  "postedAt":"2019-09-13T20:01:42.995Z",
  "updatedAt":"2019-09-13T20:04:20.721Z"
}]
```
<hr>

**DELETE** /events/:eventid
<br>Delete the specified event
<br>Response: deleted event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/events/5d7bc03180fba060b7306359

```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-14T09:12:58.453Z",
  "mapName":"\"The Enchanted Forest\""
}
```
<hr>

**DELETE** /events/:eventid/maps/:userid
<br>Delete the specified runner and associated maps from an event
<br>Response: updated event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/events/5d7bc03180fba060b7306359/maps/5d7b56f3da12cb4cae3ecb00
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[],
  "createdAt":"2019-09-13T16:13:37.860Z",
  "updatedAt":"2019-09-14T09:12:52.286Z",
  "mapName":"\"The Enchanted Forest\""
}
```
<hr>

**DELETE** /events/:eventid/maps/:userid/:maptype(course|route)/:maptitle?
<br>Delete the specified map from an event
<br>Response: updated event object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/events/5d7bc03180fba060b7306359/maps/5d7b56f3da12cb4cae3ecb00/course
```
```
{
  "_id":"5d7bc03180fba060b7306359",
  "organisedBy":[],
  "linkedTo":[],
  "locRegions":[],
  "locCornerSW":[],
  "locCornerNW":[],
  "locCornerNE":[],
  "locCornerSE":[],
  "types":[],
  "tags":[],
  "owner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "displayName":"example@example.com"
  },
  "name":"\"Example Trophy 2019\"",
  "date":"2019-09-14",
  "locPlace":"Utopia",
  "runners":[{
    "visibility":"all",
    "tags":[],
    "_id":"5d7bc36f80fba060b730635d",
    "user":{
      "_id":"5d7b56f3da12cb4cae3ecb00",
      "visibility":"public",
      "fullName":"",
      "regNumber":"DKP7703",
      "orisId":"37633",
      "memberOf":[],
      "profileImage":"http://localhost:3090/images/avatars/5d7b56f3da12cb4cae3ecb00.jpg",
      "active":true,
      "displayName":"example@example.com"
    },
    "fullResults":[],
    "maps":[],
    "comments":[],
    "courseTitle":"Long"
  }],
"createdAt":"2019-09-13T16:13:37.860Z",
"updatedAt":"2019-09-13T20:36:09.302Z",
"mapName":"\"The Enchanted Forest\""
}
```
<hr>

**DELETE** /events/:eventid/comments/:userid/:commentid
<br>Delete the specified comment from an event
<br>Response: updated comments object (JSON) *[not complete event]*

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/events/5d7bc03180fba060b7306359/comments/5d7b56f3da12cb4cae3ecb00/5d7bf5a60f55ee69d7338393
```
```
[]
```
<hr>

### Event Links

#### Public:
<hr>

**GET** /events/links[?displayName=, includes=]
<br>Retrieve a list of links between events, matching specified criteria if provided
<br>Response: array of event link objects (JSON)

```
curl http://localhost:3090/events/links
```
```
[
  {
  "_id":"5d7cb3b34af54c04d25c2a19",
  "includes":[{
    "_id":"5d7bc03180fba060b7306359",
    "name":"\"Example Trophy 2019\"",
    "date":"2019-09-14"
  }],
  "displayName":"Example events",
  "createdAt":"2019-09-14T09:32:35.095Z",
  "updatedAt":"2019-09-14T09:32:35.095Z"
  },
  {...}
]
```
<hr>


#### Requiring authentication:
<hr>

**POST** /events/links { displayName, includes }
<br>Create a new link between the specified events
<br>Response: created event link object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d '{"displayName":"Example events","includes":["5d7bc03180fba060b7306359"]}' -H 'Content-Type: application/json' http://localhost:3090/events/links
```
```
{
  "includes":[{
    "_id":"5d7bc03180fba060b7306359",
    "name":"\"Example Trophy 2019\"",
    "date":"2019-09-14"
  }],
  "_id":"5d7cb3b34af54c04d25c2a19",
  "displayName":"Example events",
  "createdAt":"2019-09-14T09:32:35.095Z",
  "updatedAt":"2019-09-14T09:32:35.095Z"
}
```
<hr>

**PATCH** /events/links/:eventlinkid { displayName?, includes? }
<br>Update the specified link between events
<br>Response: updated event link object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -d 'displayName="Example events updated"' -X PATCH http://localhost:3090/events/links/5d7cb3b34af54c04d25c2a19
```
```
{
  "_id":"5d7cb3b34af54c04d25c2a19",
  "includes":[{
    "_id":"5d7bc03180fba060b7306359",
    "name":"\"Example Trophy 2019\"",
    "date":"2019-09-14"
  }],
  "displayName":"\"Example events updated\"",
  "createdAt":"2019-09-14T09:32:35.095Z",
  "updatedAt":"2019-09-14T09:39:12.200Z"
}
```
<hr>


**DELETE** /events/links/:eventlinkid
<br>Delete the specified link between events (admin users only)
<br>Response: deleted event link object (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' -X DELETE http://localhost:3090/events/links/5d7cb3b34af54c04d25c2a19
```
```
{
  "_id":"5d7cb3b34af54c04d25c2a19",
  "includes":[{
    "_id":"5d7bc03180fba060b7306359",
    "name":"\"Example Trophy 2019\"",
    "date":"2019-09-14"
  }],
  "displayName":"\"Example events updated\"",
  "createdAt":"2019-09-14T09:32:35.095Z",
  "updatedAt":"2019-09-14T09:39:12.200Z"
}
```
<hr>

### Activity

#### Requiring authentication:
<hr>

**GET** /activity[?number=, actionType=, actionBy=, club=, comment=, event=, eventRunner=, eventLink=, user=]
<br>Retrieve a list of recent activity of given length if specified, matching specified criteria if provided
<br>Response: array of activity objects (JSON)

```
curl -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1ZDdiNTZmM2RhMTJjYjRjYWUzZWNiMDAiLCJpYXQiOjE1NjgzNjQyNzYyMzB9.3vwb0VPbnfBlo67PsOHhdqssRXxvbGZKqchEtImNDMg' http://localhost:3090/activity?number=5
```
```
[{
  "_id":"5d7bed6180fba060b7306385",
  "actionType":"EVENT_MAP_UPLOADED",
  "actionBy":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "event":{
    "_id":"5d7bc03180fba060b7306359","active":true,"name":"\"Example Trophy 2019\"","date":"2019-09-14","runners":[{"visibility":"all","user":"5d7b56f3da12cb4cae3ecb00"}]
  },
  "eventRunner":{
    "_id":"5d7b56f3da12cb4cae3ecb00","visibility":"public","memberOf":[],"active":true,"displayName":"example@example.com"
  },
  "timestamp":"2019-09-13T19:26:25.691Z",
},{
  "_id":"5d7bebe380fba060b7306382",
  "actionType":"EVENT_RUNNER_UPDATED",
  "actionBy":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "event":{
    "_id":"5d7bc03180fba060b7306359",
    "active":true,
    "name":"\"Example Trophy 2019\"",
    "date":"2019-09-14",
    "runners":[{
      "visibility":"all",
      "user":"5d7b56f3da12cb4cae3ecb00"
    }]
  },
  "eventRunner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "timestamp":"2019-09-13T19:20:03.972Z",
},{
  "_id":"5d7be8eb80fba060b7306381",
  "actionType":"EVENT_UPDATED",
  "actionBy":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "event":{
    "_id":"5d7bc03180fba060b7306359",
    "active":true,
    "name":"\"Example Trophy 2019\"",
    "date":"2019-09-14",
    "runners":[{
      "visibility":"all",
      "user":"5d7b56f3da12cb4cae3ecb00"
    }]
  },
  "timestamp":"2019-09-13T19:07:23.344Z",
},{
  "_id":"5d7bc45d80fba060b7306380",
  "actionType":"EVENT_RUNNER_ADDED",
  "actionBy":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "event":{
    "_id":"5d7bc2b980fba060b730635b",
    "active":true,
    "date":"2019-09-08",
    "name":"Žebříček B-Čechy západ",
    "runners":[{
      "visibility":"public",
      "user":"5d7b56f3da12cb4cae3ecb00"
      }]
  },
  "eventRunner":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "timestamp":"2019-09-13T16:31:25.310Z",
},{
  "_id":"5d7bc40880fba060b730635f",
  "actionType":"USER_UPDATED",
  "actionBy":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "user":{
    "_id":"5d7b56f3da12cb4cae3ecb00",
    "visibility":"public",
    "memberOf":[],
    "active":true,
    "displayName":"example@example.com"
  },
  "timestamp":"2019-09-13T16:30:00.246Z",
}]
```
<hr>

## Release History

Not yet formally released (1.0.0 expected late September 2019).

<!-- |Version|Document                                             |Date     |Purpose               |
|-------|-----------------------------------------------------|--------:|----------------------|
|1.0.0  |[Release Notes](release_notes/RELEASE_NOTES_1_0_0.md)|xx/9/2019|Initial public release| -->

## Installation

```
git clone https//github.com/markcollis/mapoholic-server.git
cd mapoholic-server
yarn install
```

Then set the following environment variables:
  * PORT (default is 3090)
  * MONGODB_URI (path to live database)
  * DB_LOCAL_URI (path to development database, data persistent, used when NODE_ENV=local)
  * DB_TEST_URI (path to test database, data cleared for each test, used when NODE_ENV=test)
  * IMAGE_URI (prefix path to turn relative image paths into full paths, should be set to API path)
  * JWT_SECRET (a random string used to generate authentication tokens)

For the MongoDB database, you can either [install it locally](https://docs.mongodb.com/manual/installation) or make use of an externally hosted service such as [MongoDB Atlas](https://mongodb.com/cloud/atlas).

## Usage

```
yarn start
```
will run the MapOholic API.

## Packages used

The following packages have been used as key components of MapOholic. Many thanks to all their authors and contributors.

  * [Node.js](https://nodejs.org)
  * [Express](https://expressjs.com)
  * [MongoDB](https://mongodb.com)/[Mongoose](https://mongoosejs.com)
  * [Passport](http://passportjs.org) (authentication)
  * [Sharp](https://sharp.pixelplumbing.com) (image processing)

## Contributing

Pull requests for minor amendments or bug fixes are welcome. If you are thinking of making more substantial changes, please open an issue first to discuss (or create your own fork and do whatever you like!).

## License
[ISC](https://choosealicense.com/licenses/isc/)
