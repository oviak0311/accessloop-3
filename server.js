// AccessLoop server: serves the front end and the API.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/prisma.js';
import { HttpError } from './lib/http.js';
import apiRouter from './routes/api.js';
import adminRouter from './routes/admin.js';
import tripsRouter from './routes/trips.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '20kb' }));

// Front end (on Vercel, files in /public are served directly)
app.use(express.static(path.join(__dirname, 'public')));

// Checks that the server can reach the database.
app.get('/api/health', async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use('/api/admin', adminRouter);
app.use('/api', tripsRouter);
app.use('/api', apiRouter);

// Unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'That API route doesn’t exist.' });
});

// Turns errors into clear JSON messages.
// Express 5 passes errors from async routes here automatically.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body isn’t valid JSON.' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    return res.status(404).json({ error: 'Report not found.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Vercel runs the exported app; locally we start a server.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`AccessLoop running at http://localhost:${port}`);
  });
}

export default app;
