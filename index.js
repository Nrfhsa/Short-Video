require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const app = express();
const router = require('./router');
const port = process.env.PORT || 5000;

/*==================== [ MIDDLEWARES ] ====================*/
app.set('trust proxy', 1);
app.set('json spaces', 2);
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later' }
});
app.use(limiter);

const requestTime = (req, res, next) => {
    req.requestTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    req.clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.connection.remoteAddress; 
    next(); 
};
app.use(requestTime);

/*==================== [ ROUTES ] ====================*/
app.use('/video', express.static(path.join(__dirname, 'public/videos'), {
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff')
}));

app.use('/', router);

/*==================== [ ERROR HANDLERS ] ====================*/
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(`[${req.requestTime}] Error:`, err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : null
  });
});

/*==================== [ SERVER INIT ] ====================*/
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Upload directory: ${path.resolve('public/videos')}`);
});