import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

export const maxLogoBytes = 5 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class UploadsService {
  private readonly uploadDir: string;
  private readonly maxImageSizeBytes: number;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = resolve(
      this.configService.get<string>('uploads.dir', 'uploads'),
    );
    this.maxImageSizeBytes = this.configService.get<number>(
      'uploads.maxImageSizeBytes',
      5 * 1024 * 1024,
    );
  }

  validateImageFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported image type. Allowed types: JPEG, PNG, WEBP, GIF',
      );
    }
    if (file.size > this.maxImageSizeBytes) {
      throw new BadRequestException(
        `Image exceeds maximum allowed size of ${this.maxImageSizeBytes} bytes`,
      );
    }
  }

  async saveImage(file: Express.Multer.File, subfolder: string) {
    this.validateImageFile(file);
    const targetDir = join(this.uploadDir, subfolder);
    await mkdir(targetDir, { recursive: true });

    const ext = extname(file.originalname) || '.jpg';
    const filename = `${randomUUID()}${ext}`;
    const fullPath = join(targetDir, filename);
    await writeFile(fullPath, file.buffer);

    return {
      url: `/uploads/${subfolder}/${filename}`,
      filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: new Date(),
    };
  }

  async withAirlineLogo<T>(
    file: Express.Multer.File | undefined,
    save: (url?: string) => Promise<T>,
  ): Promise<T> {
    if (!file) return save();
    const png =
      file.mimetype === 'image/png' &&
      file.buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpg =
      file.mimetype === 'image/jpeg' &&
      file.buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if (!png && !jpg) {
      throw new BadRequestException('Logo must be a JPG or PNG image');
    }
    const name = randomUUID() + (png ? '.png' : '.jpg');
    const logoDir = join(this.uploadDir, 'airline-logos');
    const filePath = join(logoDir, name);
    await mkdir(logoDir, { recursive: true });
    await writeFile(filePath, file.buffer, { flag: 'wx' });
    try {
      return await save('/uploads/airline-logos/' + name);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }
}
