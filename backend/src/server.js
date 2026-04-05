import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import chatRouter from './routes/chat.js';
import boardroomRouter from './routes/boardroom.js';
import briefRouter from './routes/brief.js';
import toolsRouter from './routes/tools.js';
import uploadRouter from './routes/upload.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/chat', chatRouter);
app.use('/api/boardroom', boardroomRouter);
app.use('/api/brief', briefRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/upload', uploadRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Board backend running on http://localhost:${PORT}`);
});
