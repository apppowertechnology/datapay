const axios = require('axios');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dtgklvqgh';
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'Datapay';
const API_KEY = process.env.CLOUDINARY_API_KEY || '8821821129471';

/**
 * Upload an image (base64 data URI, HTTP URL, or binary) to Cloudinary
 * using the configured unsigned/preset 'Datapay' on cloud 'dtgklvqgh'.
 * Keeps all secrets safe on the server.
 */
async function uploadImage(fileData, folder = 'strictwallet_events') {
  if (!fileData) {
    throw new Error('No image data provided for upload');
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

  try {
    const payload = {
      file: fileData,
      upload_preset: UPLOAD_PRESET,
      folder: folder
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
      timeout: 30000
    });

    const data = response.data;
    return {
      success: true,
      url: data.secure_url || data.url,
      publicId: data.public_id,
      format: data.format,
      width: data.width,
      height: data.height
    };
  } catch (error) {
    console.error('[Cloudinary Upload Error]:', error.response ? error.response.data : error.message);
    const msg = error.response?.data?.error?.message || error.message || 'Image upload to Cloudinary failed';
    return {
      success: false,
      message: msg
    };
  }
}

module.exports = {
  uploadImage
};
