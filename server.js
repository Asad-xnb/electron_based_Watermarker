const express = require('express');
const multer = require('multer');
const path = require('path');
const watermarkService = require('./services/watermarkService');

const app = express();
let serverInstance = null;

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));



// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.fields([
  { name: 'watermark', maxCount: 1 },
  { name: 'files', maxCount: 100 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.watermark || !req.files.files) {
      return res.status(400).json({ error: 'Please provide both watermark and files to process' });
    }

    const watermarkBuffer = req.files.watermark[0].buffer;
    const filesToProcess = req.files.files;
    
    const options = {
      position: req.body.position || 'bottom-right',
      opacity: parseFloat(req.body.opacity) || 0.7,
      scale: parseFloat(req.body.scale) || 0.2
    };

    // Process files and get ZIP buffer
    const zipBuffer = await watermarkService.processFilesInMemory(watermarkBuffer, filesToProcess, options);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="watermarked-files.zip"');
    res.send(zipBuffer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process files: ' + error.message });
  }
});



// Start server
function start(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    serverInstance = app
      .listen(preferredPort, () => {
        const addressInfo = serverInstance.address();
        const resolvedPort = addressInfo && addressInfo.port ? addressInfo.port : preferredPort;
        console.log(`[server] running on port ${resolvedPort}`);
        resolve(resolvedPort);
      })
      .on('error', (err) => {
        console.error('[server] failed to start', err);
        reject(err);
      });
  });
}

// Stop server
function stop() {
  if (serverInstance) {
    console.log('[server] shutting down');
    serverInstance.close();
  }
}

module.exports = { start, stop };
