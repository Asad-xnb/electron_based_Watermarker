const sharp = require('sharp');
const ffmpegStaticPath = require('ffmpeg-static');
const ffprobeStaticPath = require('ffprobe-static').path;
const { spawn } = require('child_process');
const archiver = require('archiver');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');

const resolveBinaryPath = (binaryPath) => {
  if (!binaryPath) return binaryPath;
  return binaryPath.replace('app.asar', 'app.asar.unpacked');
};

const ffmpegPath = resolveBinaryPath(ffmpegStaticPath);
const ffprobePath = resolveBinaryPath(ffprobeStaticPath);

async function processFilesInMemory(watermarkBuffer, files, options) {
  const processedFiles = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file.originalname).toLowerCase();

    try {
      let processedBuffer;
      
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        processedBuffer = await processImage(file.buffer, watermarkBuffer, options);
      } else if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
        // Videos need temp files for ffmpeg
        processedBuffer = await processVideo(file.buffer, watermarkBuffer, file.originalname, options);
      } else {
        throw new Error(`Unsupported file format: ${ext}`);
      }

      processedFiles.push({
        name: file.originalname,
        buffer: processedBuffer
      });
    } catch (error) {
      // Skip failed files
      continue;
    }
  }

  // Create ZIP in memory
  return await createZipInMemory(processedFiles);
}

async function processImage(inputBuffer, watermarkBuffer, options) {
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();

  // Resize watermark based on scale
  const watermarkWidth = Math.round(metadata.width * options.scale);
  const watermark = await sharp(watermarkBuffer)
    .resize(watermarkWidth)
    .toBuffer();

  const watermarkMetadata = await sharp(watermark).metadata();

  // Calculate position
  const position = calculatePosition(
    metadata.width,
    metadata.height,
    watermarkMetadata.width,
    watermarkMetadata.height,
    options.position
  );

  // Apply watermark with opacity
  const watermarkWithOpacity = await sharp(watermark)
    .composite([{
      input: Buffer.from([255, 255, 255, Math.round(255 * options.opacity)]),
      raw: {
        width: 1,
        height: 1,
        channels: 4
      },
      tile: true,
      blend: 'dest-in'
    }])
    .toBuffer();

  return await image
    .composite([{
      input: watermarkWithOpacity,
      top: position.top,
      left: position.left
    }])
    .toBuffer();
}

async function processVideo(inputBuffer, watermarkBuffer, filename, options) {
  // For video processing, we need temporary files as ffmpeg doesn't support stdin/stdout for complex operations
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `input_${Date.now()}_${filename}`);
  const watermarkPath = path.join(tmpDir, `wm_${Date.now()}.png`);
  const outputPath = path.join(tmpDir, `output_${Date.now()}_${filename}`);

  try {
    // Write temp files
    await fs.writeFile(inputPath, inputBuffer);
    await fs.writeFile(watermarkPath, watermarkBuffer);

    // Get video dimensions first using ffprobe
    const ffprobeArgs = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      inputPath
    ];

    const probeData = await new Promise((resolve, reject) => {
      const ffprobe = spawn(ffprobePath, ffprobeArgs);
      let data = '';

      ffprobe.stdout.on('data', (chunk) => {
        data += chunk.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) resolve(data);
        else reject(new Error('Failed to probe video'));
      });

      ffprobe.on('error', reject);
    });

    const metadata = JSON.parse(probeData);
    const stream = metadata.streams[0];
    if (!stream) throw new Error('No video stream found');

    const width = stream.width;
    const height = stream.height;

    // Calculate watermark position for video
    const position = getVideoPosition(width, height, options.position, options.scale);

    // Process video with ffmpeg
    const ffmpegArgs = [
      '-i', inputPath,
      '-i', watermarkPath,
      '-filter_complex',
      `[1:v]scale=${Math.round(width * options.scale)}:-1[wm];[wm]format=rgba,colorchannelmixer=aa=${options.opacity}[wm_opacity];[0:v][wm_opacity]overlay=${position}[outv]`,
      '-map', '[outv]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'copy',
      '-y',
      outputPath
    ];

    await new Promise((resolve, reject) => {
      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

      ffmpegProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });

      ffmpegProcess.on('error', reject);
    });

    // Read the output file
    const outputBuffer = await fs.readFile(outputPath);

    // Clean up temp files
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(watermarkPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);

    return outputBuffer;
  } catch (error) {
    // Clean up on error
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(watermarkPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);
    throw error;
  }

}

function calculatePosition(imgWidth, imgHeight, wmWidth, wmHeight, position) {
  const padding = 20;
  const positions = {
    'top-left': { top: padding, left: padding },
    'top-center': { top: padding, left: Math.round((imgWidth - wmWidth) / 2) },
    'top-right': { top: padding, left: imgWidth - wmWidth - padding },
    'center': { 
      top: Math.round((imgHeight - wmHeight) / 2), 
      left: Math.round((imgWidth - wmWidth) / 2) 
    },
    'bottom-left': { top: imgHeight - wmHeight - padding, left: padding },
    'bottom-center': { 
      top: imgHeight - wmHeight - padding, 
      left: Math.round((imgWidth - wmWidth) / 2) 
    },
    'bottom-right': { 
      top: imgHeight - wmHeight - padding, 
      left: imgWidth - wmWidth - padding 
    }
  };

  return positions[position] || positions['bottom-right'];
}

function getVideoPosition(width, height, position, scale) {
  const padding = 20;

  const positions = {
    'top-left': `${padding}:${padding}`,
    'top-center': `(W-w)/2:${padding}`,
    'top-right': `W-w-${padding}:${padding}`,
    'center': `(W-w)/2:(H-h)/2`,
    'bottom-left': `${padding}:H-h-${padding}`,
    'bottom-center': `(W-w)/2:H-h-${padding}`,
    'bottom-right': `W-w-${padding}:H-h-${padding}`
  };

  return positions[position] || positions['bottom-right'];
}

async function createZipInMemory(processedFiles) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('data', (chunk) => {
      buffers.push(chunk);
    });

    archive.on('end', () => {
      resolve(Buffer.concat(buffers));
    });

    archive.on('error', (err) => {
      reject(err);
    });

    // Add files to archive
    processedFiles.forEach(file => {
      archive.append(file.buffer, { name: file.name });
    });

    archive.finalize();
  });
}

module.exports = {
  processFilesInMemory
};
