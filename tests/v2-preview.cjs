// Local browser QA only. This entry is never imported by the production server.
const express = require('express');
const { memoryStore, questions } = require('./v2-fixture.cjs');
const app = express();
const port = process.env.PORT || '3497';
require('../v2')(app, { store: memoryStore(), env: { PORT: port, KOOKMIN_KEY: 'local-fixture' }, generate: async () => questions });
app.listen(Number(port), '127.0.0.1', () => console.log(`v2 fixture: http://127.0.0.1:${port}/v2/`));
