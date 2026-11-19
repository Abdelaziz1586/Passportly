import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Express } from 'express';
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
    if (file.size > this.maxImageSizeBytes) {
      throw new BadRequestException(
        `Image must be no larger than ${this.maxImageSizeBytes} bytes`,
      );
    }

    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Image must be JPEG, PNG, GIF, or WebP');
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
      sizeBytes: file.size,
      uploadedAt: new Date(),
    };
  }

  async removeImage(filename: string): Promise<void> {
    if (!/^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/.test(filename)) {
      throw new BadRequestException('Invalid uploaded image filename');
    }

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
