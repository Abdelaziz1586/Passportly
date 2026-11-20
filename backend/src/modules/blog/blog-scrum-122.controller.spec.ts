import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

describe('BlogController (SCRUM-122 BLG-04 delete post)', () => {
  let controller: BlogController;

  const mockBlogService = {
    deletePost: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER or Role.ADMIN on deletePost', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'deletePost',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
      Role.ADMIN,
    ]);
  });

  it('delegates id, user, and ip to BlogService.deletePost', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;
    const expected = { message: 'Blog post deleted successfully', id: postId };
    mockBlogService.deletePost.mockResolvedValue(expected);

    const result = await controller.deletePost(postId, user, req);

    expect(result).toEqual(expected);
    expect(mockBlogService.deletePost).toHaveBeenCalledWith(
      postId,
      user,
      '127.0.0.1',
    );
  });
});
