import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

describe('BlogController (SCRUM-128 BLG-10/GEN-08 upload post image)', () => {
  let controller: BlogController;

  const mockBlogService = {
    uploadPostImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on uploadPostImage', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'uploadPostImage',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('delegates id, userId, and uploaded file to BlogService.uploadPostImage', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const file = {
      fieldname: 'image',
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: 16,
      buffer: Buffer.from('89504e470d0a1a0a0000000d', 'hex'),
    } as Express.Multer.File;

    const expected = {
      image: {
        id: '673c1f2a9c4b2d001f8a9999',
        url: '/uploads/blog-posts/abc.png',
        filename: 'abc.png',
        mimeType: 'image/png',
        sizeBytes: 16,
        uploadedAt: new Date(),
      },
      images: [],
    };
    mockBlogService.uploadPostImage.mockResolvedValue(expected);

    const result = await controller.uploadPostImage(postId, user, file);

    expect(result).toEqual(expected);
    expect(mockBlogService.uploadPostImage).toHaveBeenCalledWith(
      postId,
      user.userId,
      file,
    );
  });
});
