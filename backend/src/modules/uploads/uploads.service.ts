import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
export const maxLogoBytes = 5 * 1024 * 1024;

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  async withAirlineLogo<T>(
    file: Express.Multer.File | undefined,
    save: (url?: string) => Promise<T>,
  ) {
    if (!file) return save();
    const png =
      file.mimetype === 'image/png' &&
      file.buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpg =
      file.mimetype === 'image/jpeg' &&
      file.buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if (!png && !jpg)
      throw new BadRequestException('Logo must be a JPG or PNG image');
    const name = randomUUID() + (png ? '.png' : '.jpg');
    const logoDir = resolve(
      this.config.get<string>('uploads.dir', 'uploads'),
      'airline-logos',
    );
    const path = join(logoDir, name);
    await mkdir(logoDir, { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });
    try {
      return await save('/uploads/airline-logos/' + name);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }
}
