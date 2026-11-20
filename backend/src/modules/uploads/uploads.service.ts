import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { MediaItem } from '../../common/schemas/media-item.schema';

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

  private imageType(buffer: Buffer): 'image/jpeg' | 'image/png' {
    if (buffer.length > this.maxImageSizeBytes || buffer.length < 12) {
      throw new BadRequestException(
        'Images must be JPG or PNG and at most 5 MB',
      );
    }
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      return 'image/png';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    throw new BadRequestException('Image contents must be JPG or PNG');
  }

  async withAirlineLogo<T>(
    file: Express.Multer.File | undefined,
    save: (url?: string) => Promise<T>,
  ): Promise<T> {
    if (!file) return save();
    let mimeType: 'image/jpeg' | 'image/png';
    try {
      mimeType = this.imageType(file.buffer);
    } catch {
      throw new BadRequestException('Logo must be a JPG or PNG image');
    }
    if (file.mimetype !== mimeType) {
      throw new BadRequestException('Logo must be a JPG or PNG image');
    }
    const name = randomUUID() + (mimeType === 'image/png' ? '.png' : '.jpg');
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

  async storeImage(file: Express.Multer.File): Promise<MediaItem> {
    if (!file?.buffer) {
      throw new BadRequestException('Image file is required');
    }
    const mimeType = this.imageType(file.buffer);
    if (file.mimetype !== mimeType) {
      throw new BadRequestException(
        'Image MIME type does not match its contents',
      );
    }
    const filename = `${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(join(this.uploadDir, filename), file.buffer, {
      flag: 'wx',
    });
    return {
      url: `/uploads/${filename}`,
      filename,
      mimeType,
      sizeBytes: file.buffer.length,
      uploadedAt: new Date(),
    };
  }

  /** Rebuild metadata from disk so JSON cannot invent a file, size or MIME type. */
  async storedImages(
    images: { filename: string; url: string }[],
  ): Promise<MediaItem[]> {
    const result: MediaItem[] = [];
    for (const image of images) {
      if (
        !/^[a-f\d-]{36}\.(jpg|png)$/i.test(image.filename) ||
        image.url !== `/uploads/${image.filename}`
      ) {
        throw new BadRequestException(
          'Images must reference server-stored uploads',
        );
      }
      try {
        const location = join(this.uploadDir, image.filename);
        const info = await stat(location);
        if (!info.isFile() || info.size > this.maxImageSizeBytes) {
          throw new BadRequestException('Invalid image file');
        }
        const buffer = await readFile(location);
        result.push({
          url: image.url,
          filename: image.filename,
          mimeType: this.imageType(buffer),
          sizeBytes: buffer.length,
          uploadedAt: info.birthtime,
        });
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('Image file was not found on the server');
      }
    }
    return result;
  }

  async discard(images: MediaItem[]): Promise<void> {
    await Promise.all(
      images.map(async (image) => {
        if (!/^[a-f\d-]{36}\.(jpg|png)$/i.test(image.filename)) return;
        await unlink(join(this.uploadDir, image.filename)).catch(
          () => undefined,
        );
      }),
    );
  }
}
