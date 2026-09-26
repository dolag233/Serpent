import { describe, expect, it } from 'vitest';

import {
  artifactProtocolMimeForExtension,
  directImageMimeForExtension,
  imageDecoderForExtension,
  imageViewerDecoderForExtension,
  imageMimeForExtension,
  isChromiumDirectPlayVideoExtension,
  isRawImageExtension,
  isSupportedImageExtension,
  isSupportedDocumentExtension,
  isSupportedModelExtension,
  isSupportedVideoExtension,
  mediaTypeHasPixelResolution,
  modelMimeForExtension,
  videoMimeForExtension,
} from '../../src/shared/media-formats';

describe('media format registry', () => {
  it('routes web-native and derived images through the intended decoder', () => {
    expect(imageDecoderForExtension('poster.PNG')).toBe('sharp');
    expect(imageDecoderForExtension('poster.JFIF')).toBe('sharp');
    expect(isSupportedImageExtension('poster.jfif')).toBe(true);
    expect(directImageMimeForExtension('.jfif')).toBe('image/jpeg');
    expect(imageMimeForExtension('poster.JFIF')).toBe('image/jpeg');
    expect(imageDecoderForExtension('art.svg')).toBe('sharp');
    for (const extension of ['.bmp', '.ico', '.psd', '.exr', '.tga']) {
      expect(imageDecoderForExtension(extension)).toBe('oiio');
    }
    expect(imageDecoderForExtension('.zip')).toBeNull();
    expect(directImageMimeForExtension('.png')).toBe('image/png');
    expect(directImageMimeForExtension('.avif')).toBe('image/avif');
    expect(directImageMimeForExtension('photo.AVIF')).toBe('image/avif');
    expect(imageDecoderForExtension('.avif')).toBe('sharp');
    expect(imageMimeForExtension('.avif')).toBe('image/avif');
    expect(isSupportedImageExtension('photo.avif')).toBe(true);
    expect(directImageMimeForExtension('.tiff')).toBeNull();
    expect(directImageMimeForExtension('.psd')).toBeNull();
    expect(imageViewerDecoderForExtension('.tiff')).toBe('oiio');
    expect(imageViewerDecoderForExtension('.tga')).toBe('oiio');
    expect(imageViewerDecoderForExtension('.arw')).toBe('oiio');
    expect(imageViewerDecoderForExtension('.png')).toBe('sharp');
  });

  it('declares the MVP RAW set as OIIO-derived images', () => {
    for (const extension of ['.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2', '.raw']) {
      expect(isSupportedImageExtension(`camera${extension}`)).toBe(true);
      expect(isRawImageExtension(`camera${extension}`)).toBe(true);
      expect(imageDecoderForExtension(extension)).toBe('oiio');
      expect(imageMimeForExtension(extension)).toMatch(/^image\//);
    }
  });

  it('keeps every supported video container on the proxy-capable route', () => {
    for (const extension of ['.mp4', '.mov', '.avi', '.wmv', '.webm', '.mkv', '.m4v', '.flv']) {
      expect(isSupportedVideoExtension(`clip${extension}`)).toBe(true);
      expect(videoMimeForExtension(extension)).toMatch(/^video\//);
    }
    expect(videoMimeForExtension('.flv')).toBe('video/x-flv');
    expect(isSupportedVideoExtension('clip.mpeg')).toBe(false);
  });

  it('registers PDF-compatible Illustrator files as documents', () => {
    expect(isSupportedDocumentExtension('Artwork.AI')).toBe(true);
    expect(isSupportedDocumentExtension('Artwork.ai')).toBe(true);
    expect(isSupportedDocumentExtension('Artwork.ai.txt')).toBe(false);
  });

  it('treats only Chromium-playable containers as viewer source-first', () => {
    expect(isChromiumDirectPlayVideoExtension('clip.mp4')).toBe(true);
    expect(isChromiumDirectPlayVideoExtension('.webm')).toBe(true);
    expect(isChromiumDirectPlayVideoExtension('.m4v')).toBe(true);
    expect(isChromiumDirectPlayVideoExtension('clip.MOV')).toBe(false);
    expect(isChromiumDirectPlayVideoExtension('.avi')).toBe(false);
    expect(isChromiumDirectPlayVideoExtension('.wmv')).toBe(false);
    expect(isChromiumDirectPlayVideoExtension('.mkv')).toBe(false);
  });

  it('serves H.264 playback proxies as video/mp4 over serpent://', () => {
    expect(artifactProtocolMimeForExtension('proxy.mp4')).toBe('video/mp4');
    expect(artifactProtocolMimeForExtension('.MP4')).toBe('video/mp4');
    expect(artifactProtocolMimeForExtension('.webm')).toBe('video/webm');
    expect(artifactProtocolMimeForExtension('.webp')).toBe('image/webp');
    expect(artifactProtocolMimeForExtension('.ogg')).toBe('audio/ogg');
    expect(artifactProtocolMimeForExtension('.bin')).toBe('application/octet-stream');
  });

  it('serves SVG viewers from the original vector source', () => {
    expect(directImageMimeForExtension('.svg')).toBe('image/svg+xml');
    expect(directImageMimeForExtension('icon.SVG')).toBe('image/svg+xml');
  });

  it('registers the T1 3D set case-insensitively (slice A)', () => {
    for (const extension of ['.fbx', '.obj', '.gltf', '.glb', '.stl']) {
      expect(isSupportedModelExtension(`model${extension}`)).toBe(true);
      expect(isSupportedModelExtension(`model${extension.toUpperCase()}`)).toBe(true);
      expect(modelMimeForExtension(extension)).toMatch(/^model\//);
    }
    expect(isSupportedModelExtension('scene.3ds')).toBe(false);
    expect(isSupportedModelExtension('project.blend')).toBe(false);
    expect(isSupportedModelExtension('texture.png')).toBe(false);
    expect(isSupportedModelExtension('model')).toBe(false);
    // Multi-dot names resolve by final extension only, like images/videos.
    expect(isSupportedModelExtension('character.rig.fbx')).toBe(true);
  });

  it('maps each T1 model extension to its product MIME label', () => {
    expect(modelMimeForExtension('.glb')).toBe('model/gltf-binary');
    expect(modelMimeForExtension('.gltf')).toBe('model/gltf+json');
    expect(modelMimeForExtension('.obj')).toBe('model/obj');
    expect(modelMimeForExtension('.fbx')).toBe('model/fbx');
    expect(modelMimeForExtension('.stl')).toBe('model/stl');
    expect(modelMimeForExtension('.zip')).toBeNull();
  });

  it('limits pixel resolution to image and video media (Serpent-b1b0f2)', () => {
    // Cards, the Inspector summary row and the resolution filter all read this
    // one predicate: images (GIF included) and videos own a resolution.
    expect(mediaTypeHasPixelResolution('image')).toBe(true);
    expect(mediaTypeHasPixelResolution('video')).toBe(true);
    // A 3D model carries a bounding box and a document a page size; neither is
    // a resolution users filter or read.
    expect(mediaTypeHasPixelResolution('model')).toBe(false);
    expect(mediaTypeHasPixelResolution('document')).toBe(false);
    expect(mediaTypeHasPixelResolution('audio')).toBe(false);
    expect(mediaTypeHasPixelResolution('text')).toBe(false);
    expect(mediaTypeHasPixelResolution('other')).toBe(false);
    expect(mediaTypeHasPixelResolution(null)).toBe(false);
    expect(mediaTypeHasPixelResolution(undefined)).toBe(false);
  });
});
