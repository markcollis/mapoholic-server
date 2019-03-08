// *** NOT DONE YET ***
//
//
//
// // *** /events routes ***  [OEvent and LinkedEvent models]
// // ids need to be more explicit as several levels
// // create an event
// app.post('/events', requireAuth, (req, res) => {
//   res.send({ message: 'POST /events is still TBD' });
// });
// // create a map within the specified event
// app.post('/events/:eventid/maps', requireAuth, (req, res) => {
//   res.send({ message: 'POST /events/:id/maps is still TBD' });
// });
// // upload a scanned map to the specified map document
// app.post('/events/:eventid/maps/:mapid', requireAuth, Events.validateMapUploadPermission,
//   images.uploadMap.single('upload'), Events.postMap, images.errorHandler);
// // create a new event linkage between the specified events
// app.post('/events/links', requireAuth, (req, res) => {
//   res.send({ message: 'POST /events/links is still TBD' });
// });
// // retrieve a list of all events (ids) matching specified criteria
// //   [may include events without *maps* visible to current user]
// app.get('/events', requireAuth, (req, res) => {
//   res.send({ message: 'GET /events is still TBD' });
// });
// // retrieve a list of all events (ids) with publicly visible maps
// //   [unlike authorised list there is no point in events without maps]
// app.get('/events/public', (req, res) => {
//   res.send({ message: 'GET /events/public is still TBD' });
// });
// // retrieve full details for the specified event
// //   [includes embedded maps and basic info for linked events]
// app.get('/events/:id', (req, res) => {
//   res.send({ message: 'GET /events/:id is still TBD' });
// });
// // retrieve a list of links between events matching specified criteria
// app.get('/events/links', requireAuth, (req, res) => {
//   res.send({ message: 'GET /events/links is still TBD' });
// });
// // retrieve full details of the specified link between events
// app.get('/events/links/:id', (req, res) => {
//   res.send({ message: 'GET /events/links/:id is still TBD' });
// });
// // update the specified event (multiple amendment not supported)
// app.patch('/events/:id', requireAuth, (req, res) => {
//   res.send({ message: 'PATCH /events/:id is still TBD' });
// });
// // update the specified map (multiple amendment not supported)
// app.patch('/events/:id/maps/:id', requireAuth, (req, res) => {
//   res.send({ message: 'PATCH /events/:id/maps/:id is still TBD' });
// });
// // update the specified link between events (multiple amendment not supported)
// app.patch('/events/links/:id', requireAuth, (req, res) => {
//   res.send({ message: 'PATCH /events/links/:id is still TBD' });
// });
// // delete the specified event (multiple delete not supported)
// //   [also deletes embedded maps if same owner, otherwise fails]
// app.delete('/events/:id', requireAuth, (req, res) => {
//   res.send({ message: 'DELETE /events/:id is still TBD' });
// });
// // delete the specified map (multiple delete not supported)
// app.delete('/events/:id/maps/:id', requireAuth, (req, res) => {
//   res.send({ message: 'DELETE /events/:id/maps/:id is still TBD' });
// });
// // delete the specified link between events (multiple delete not supported)
// app.delete('/events/links/:id', requireAuth, (req, res) => {
//   res.send({ message: 'DELETE /events/links/:id is still TBD' });
// });
