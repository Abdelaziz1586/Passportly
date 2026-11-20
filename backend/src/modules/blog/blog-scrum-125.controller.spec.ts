import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

describe('BlogController (SCRUM-125 BLG-07 delete comment)', () => {
  let controller: BlogController;

  const mockBlogService = {
    deleteComment: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER or Role.ADMIN on deleteComment', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'deleteComment',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
      Role.ADMIN,
    ]);
  });

  it('delegates id, user, and ip to BlogService.deleteComment', async () => {
    const commentId = '673c1f2a9c4b2d001f8a4444';
    const postId = '673c1f2a9c4b2d001f8a2222';
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;
    const expected = {
      message: 'Comment deleted successfully',
      id: commentId,
      postId,
    };
    mockBlogService.deleteComment.mockResolvedValue(expected);

    const result = await controller.deleteComment(commentId, user, req);

    expect(result).toEqual(expected);
    expect(mockBlogService.deleteComment).toHaveBeenCalledWith(
      commentId,
      user,
      '127.0.0.1',
    );
  });
});
