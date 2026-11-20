import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { UpdateCommentDto } from './dto/update-comment.dto';

describe('BlogController (SCRUM-124 BLG-07 update comment)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    updateComment: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on updateComment', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'updateComment',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('validates UpdateCommentDto and delegates to BlogService.updateComment', async () => {
    const commentId = '673c1f2a9c4b2d001f8a4444';
    const dto = (await validationPipe.transform(
      { content: '  Updated comment text  ' },
      { type: 'body', metatype: UpdateCommentDto },
    )) as UpdateCommentDto;

    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const expected = {
      id: commentId,
      post: '673c1f2a9c4b2d001f8a2222',
      author: user.userId,
      content: 'Updated comment text',
      isHidden: false,
    };
    mockBlogService.updateComment.mockResolvedValue(expected);

    const result = await controller.updateComment(commentId, user, dto);

    expect(result).toEqual(expected);
    expect(mockBlogService.updateComment).toHaveBeenCalledWith(
      commentId,
      user.userId,
      dto,
    );
  });

  it('rejects empty content via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { content: '   ' },
        { type: 'body', metatype: UpdateCommentDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
