import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { MediaItem } from '../../common/schemas/media-item.schema';

export const maxLogoBytes = 5 * 1024 * 1024;

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

  validateImageFile(file: Express.Multer.File): ImageSignature {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException('Image file is required');
    }
    const maxBytes = this.configService.get<number>(
      'uploads.maxImageSizeBytes',
      this.maxImageSizeBytes,
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
    return matchedSignature;
  }

  async saveImage(
    file: Express.Multer.File | undefined,
    subDir?: string,
  ): Promise<MediaItem> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    const signature = this.validateImageFile(file);
    const sizeBytes = file.size ?? file.buffer.length;
    const filename = `${randomUUID()}${signature.extension}`;

    const baseDir = resolve(
      this.configService.get<string>('uploads.dir', this.uploadDir),
    );
    if (subDir) {
      const safeSubDir = subDir.replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
      const targetDir = resolve(baseDir, safeSubDir);
      if (!targetDir.startsWith(`${baseDir}${sep}`) && targetDir !== baseDir) {
        throw new BadRequestException('Invalid upload directory');
      }
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, filename), file.buffer, { flag: 'wx' });
      return {
        url: `/uploads/${safeSubDir}/${filename}`,
        filename,
        mimeType: signature.mimeType,
        sizeBytes,
        uploadedAt: new Date(),
      };
    }

    await mkdir(baseDir, { recursive: true });
    await writeFile(join(baseDir, filename), file.buffer, { flag: 'wx' });
    return {
      url: `/uploads/${filename}`,
      filename,
      mimeType: signature.mimeType,
      sizeBytes,
      uploadedAt: new Date(),
    };
  }

  async copyImage(image: MediaItem): Promise<MediaItem> {
    this.assertFilename(image.filename);
    const baseDir = resolve(
      this.configService.get<string>('uploads.dir', this.uploadDir),
    );
    const buffer = await readFile(join(baseDir, image.filename));
    return this.saveImage({
      buffer,
      size: buffer.length,
      mimetype: image.mimeType,
    } as Express.Multer.File);
  }

  private assertFilename(filename: string): void {
    if (!/^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/i.test(filename)) {
      throw new BadRequestException('Invalid uploaded image filename');
    }
  }

  async removeImage(filename: string): Promise<void> {
    this.assertFilename(filename);
    const baseDir = resolve(
      this.configService.get<string>('uploads.dir', this.uploadDir),
    );
    try {
      await unlink(join(baseDir, filename));
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
      this.configService.get<string>('uploads.dir', this.uploadDir),
    );
    const targetPath = resolve(baseDir, ...safeSegments);
    if (!targetPath.startsWith(`${baseDir}${sep}`)) {
      return;
    }
    await unlink(targetPath).catch(() => undefined);
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
