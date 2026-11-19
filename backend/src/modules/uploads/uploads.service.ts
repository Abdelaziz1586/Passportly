import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { MediaItem } from '../../common/schemas/media-item.schema';

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  private directory(): string {
    return path.resolve(this.config.get<string>('uploads.dir', 'uploads'));
  }

  private imageType(buffer: Buffer): 'image/jpeg' | 'image/png' {
    if (buffer.length > 5 * 1024 * 1024 || buffer.length < 12) {
      throw new BadRequestException(
        'Images must be JPG or PNG and at most 5 MB',
      );
    }
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      return 'image/jpeg';
    throw new BadRequestException('Image contents must be JPG or PNG');
  }

  async storeImage(file: Express.Multer.File): Promise<MediaItem> {
    const mimeType = this.imageType(file.buffer);
    if (file.mimetype !== mimeType)
      throw new BadRequestException(
        'Image MIME type does not match its contents',
      );
    const filename = `${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    await mkdir(this.directory(), { recursive: true });
    await writeFile(path.join(this.directory(), filename), file.buffer, {
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
        const location = path.join(this.directory(), image.filename);
        const info = await stat(location);
        if (!info.isFile() || info.size > 5 * 1024 * 1024)
          throw new BadRequestException('Invalid image file');
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
        await unlink(path.join(this.directory(), image.filename)).catch(
          () => undefined,
        );
      }),
    );
  }
}
