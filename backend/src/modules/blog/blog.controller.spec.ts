import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

describe('BlogController (SCRUM-127 BLG-06 unlike post)', () => {
  let controller: BlogController;

  const mockBlogService = {
    unlikePost: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on unlikePost', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'unlikePost',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('delegates id and userId to BlogService.unlikePost', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const expected = {
      message: 'Like removed successfully',
      postId,
      liked: false,
      likesCount: 4,
    };
    mockBlogService.unlikePost.mockResolvedValue(expected);

    const result = await controller.unlikePost(postId, user);

    expect(result).toEqual(expected);
    expect(mockBlogService.unlikePost).toHaveBeenCalledWith(
      postId,
      user.userId,
    );
  });
});
