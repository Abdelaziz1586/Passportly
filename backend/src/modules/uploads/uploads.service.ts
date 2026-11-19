import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { MediaItem } from '../../common/schemas/media-item.schema';

interface ImageSignature {
  mimeType: string;
  extension: string;
  matches: (buffer: Buffer) => boolean;
}

const SUPPORTED_IMAGE_SIGNATURES: ImageSignature[] = [
  {
    mimeType: 'image/png',
    extension: '.png',
    matches: (buf) =>
      buf.length >= 8 &&
      buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  {
    mimeType: 'image/jpeg',
    extension: '.jpg',
    matches: (buf) =>
      buf.length >= 3 &&
      buf.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
  },
  {
    mimeType: 'image/gif',
    extension: '.gif',
    matches: (buf) =>
      buf.length >= 6 &&
      (buf.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        buf.subarray(0, 6).toString('ascii') === 'GIF89a'),
  },
  {
    mimeType: 'image/webp',
    extension: '.webp',
    matches: (buf) =>
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

@Injectable()
export class UploadsService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Validates image MIME type, magic bytes, and size, then stores it safely
   * under the configured upload directory and returns MediaItem metadata.
   */
  async saveImage(
    file: Express.Multer.File | undefined,
    subDir = 'general',
  ): Promise<MediaItem> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Image file is required');
    }

    const maxBytes = this.configService.get<number>(
      'uploads.maxImageSizeBytes',
      5 * 1024 * 1024,
    );
    const sizeBytes = file.size ?? file.buffer.length;
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(
        `Image size exceeds the maximum allowed limit of ${maxBytes} bytes`,
      );
    }

    const normalizedMime = file.mimetype?.toLowerCase().trim();
    const canonicalMime =
      normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime;

    const matchedSignature = SUPPORTED_IMAGE_SIGNATURES.find(
      (sig) => sig.mimeType === canonicalMime && sig.matches(file.buffer),
    );
    if (!matchedSignature) {
      throw new BadRequestException(
        'Only valid JPEG, PNG, GIF, or WebP images are allowed',
      );
    }

    const safeSubDir = subDir.replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
    const baseDir = resolve(
      this.configService.get<string>('uploads.dir', 'uploads'),
    );
    const targetDir = resolve(baseDir, safeSubDir);

    if (!targetDir.startsWith(`${baseDir}${sep}`) && targetDir !== baseDir) {
      throw new BadRequestException('Invalid upload directory');
    }

    const filename = `${randomUUID()}${matchedSignature.extension}`;
    const targetPath = join(targetDir, filename);

    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, file.buffer, { flag: 'wx' });

    return {
      url: `/uploads/${safeSubDir}/${filename}`,
      filename,
      mimeType: matchedSignature.mimeType,
      sizeBytes,
      uploadedAt: new Date(),
    };
  }

  /**
   * Safely deletes an uploaded image inside the configured upload directory.
   */
  async deleteImage(imageUrl: string): Promise<void> {
    if (!imageUrl || !imageUrl.startsWith('/uploads/')) {
      return;
    }

    const relative = imageUrl.slice('/uploads/'.length);
    const segments = relative.split('/').filter(Boolean);
    if (segments.length === 0 || segments.length > 2) {
      return;
    }

    const safeSegments = segments.map((seg, idx) =>
      idx === segments.length - 1 ? basename(seg) : seg,
    );
    const baseDir = resolve(
      this.configService.get<string>('uploads.dir', 'uploads'),
    );
    const targetPath = resolve(baseDir, ...safeSegments);

    if (!targetPath.startsWith(`${baseDir}${sep}`)) {
      return;
    }

    await unlink(targetPath).catch(() => undefined);
  }
}
