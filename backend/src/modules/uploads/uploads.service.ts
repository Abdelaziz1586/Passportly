import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { MediaItem } from '../../common/schemas/media-item.schema';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

@Injectable()
export class UploadsService {
  private readonly uploadDirectory: string;
  private readonly maxImageSizeBytes: number;

  constructor(configService: ConfigService) {
    this.uploadDirectory = path.resolve(
      configService.get<string>('uploads.dir', 'uploads'),
    );
    this.maxImageSizeBytes = configService.get<number>(
      'uploads.maxImageSizeBytes',
      5 * 1024 * 1024,
    );
  }

  async saveImage(file: Express.Multer.File): Promise<MediaItem> {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException('An image file is required');
    }
    if (file.buffer.length > this.maxImageSizeBytes) {
      throw new BadRequestException(
        `Image must be no larger than ${this.maxImageSizeBytes} bytes`,
      );
    }

    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Image must be JPEG, PNG, GIF, or WebP');
    }
    const buffer = file.buffer;
    const hasSignature =
      (file.mimetype === 'image/png' &&
        buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (file.mimetype === 'image/jpeg' &&
        buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
      (file.mimetype === 'image/gif' &&
        ['GIF87a', 'GIF89a'].includes(
          buffer.subarray(0, 6).toString('ascii'),
        )) ||
      (file.mimetype === 'image/webp' &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!hasSignature) {
      throw new BadRequestException(
        'Image content does not match its MIME type',
      );
    }

    const filename = `${randomUUID()}${extension}`;
    await mkdir(this.uploadDirectory, { recursive: true });
    await writeFile(path.join(this.uploadDirectory, filename), file.buffer, {
      flag: 'wx',
    });

    return {
      url: `/uploads/${filename}`,
      filename,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      uploadedAt: new Date(),
    };
  }

  async copyImage(image: MediaItem): Promise<MediaItem> {
    this.assertFilename(image.filename);
    const buffer = await readFile(
      path.join(this.uploadDirectory, image.filename),
    );
    return this.saveImage({
      buffer,
      size: buffer.length,
      mimetype: image.mimeType,
    } as Express.Multer.File);
  }

  private assertFilename(filename: string): void {
    if (!/^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/.test(filename)) {
      throw new BadRequestException('Invalid uploaded image filename');
    }
  }

  async removeImage(filename: string): Promise<void> {
    this.assertFilename(filename);

    try {
      await unlink(path.join(this.uploadDirectory, filename));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }
}
