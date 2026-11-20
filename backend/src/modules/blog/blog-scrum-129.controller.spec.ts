import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

describe('BlogController (SCRUM-129 BLG-10 delete post image)', () => {
  let controller: BlogController;

  const mockBlogService = {
    deletePostImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on deletePostImage', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'deletePostImage',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('delegates id, imageId, and userId to BlogService.deletePostImage', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const imageId = '673c1f2a9c4b2d001f8a9999';
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const expected = {
      message: 'Image deleted successfully',
      postId,
      imageId,
      images: [],
    };
    mockBlogService.deletePostImage.mockResolvedValue(expected);

    const result = await controller.deletePostImage(postId, imageId, user);

    expect(result).toEqual(expected);
    expect(mockBlogService.deletePostImage).toHaveBeenCalledWith(
      postId,
      imageId,
      user.userId,
    );
  });
});
