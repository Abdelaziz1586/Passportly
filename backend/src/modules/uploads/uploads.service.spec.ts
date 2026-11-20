import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadsService } from './uploads.service';

describe('UploadsService (GEN-08 image validation & storage)', () => {
  let service: UploadsService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'passportly-uploads-'));

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'uploads.dir') return tempDir;
        if (key === 'uploads.maxImageSizeBytes') return 1024;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves valid PNG image and cleans it up on deleteImage', async () => {
    const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const file = {
      originalname: 'test.png',
      mimetype: 'image/png',
      size: pngBuffer.length,
      buffer: pngBuffer,
    } as Express.Multer.File;

    const item = await service.saveImage(file, 'blog-posts');
    expect(item.url).toMatch(/^\/uploads\/blog-posts\/[a-f0-9-]+\.png$/);
    expect(item.mimeType).toBe('image/png');
    expect(item.sizeBytes).toBe(pngBuffer.length);

    await expect(service.deleteImage(item.url)).resolves.toBeUndefined();
  });

  it('rejects spoofed MIME type when magic bytes do not match', async () => {
    const fakeFile = {
      originalname: 'evil.png',
      mimetype: 'image/png',
      size: 20,
      buffer: Buffer.from('<script>alert(1)</script>'),
    } as Express.Multer.File;

    await expect(service.saveImage(fakeFile, 'blog-posts')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects oversized images exceeding configured maxImageSizeBytes', async () => {
    const bigBuffer = Buffer.concat([
      Buffer.from('ffd8ffe0', 'hex'),
      Buffer.alloc(2048),
    ]);
    const bigFile = {
      originalname: 'huge.jpg',
      mimetype: 'image/jpeg',
      size: bigBuffer.length,
      buffer: bigBuffer,
    } as Express.Multer.File;

    await expect(service.saveImage(bigFile, 'blog-posts')).rejects.toThrow(
      BadRequestException,
    );
  });
});
