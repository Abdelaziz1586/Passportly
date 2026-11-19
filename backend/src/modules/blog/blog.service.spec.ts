import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { BlogPost } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Tag } from './schemas/tag.schema';

describe('BlogService (SCRUM-128 BLG-10/GEN-08 upload post image)', () => {
  let service: BlogService;

  const mockBlogPostModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const mockUploadsService = {
    saveImage: jest.fn(),
    deleteImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUploadsService.deleteImage.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: {} },
        { provide: getModelToken(Like.name), useValue: {} },
        { provide: getModelToken(Tag.name), useValue: {} },
        { provide: UploadsService, useValue: mockUploadsService },
      ],
    }).compile();

    service = module.get<BlogService>(BlogService);
  });

  const sampleFile = {
    originalname: 'photo.png',
    mimetype: 'image/png',
    size: 16,
    buffer: Buffer.from('89504e470d0a1a0a0000000d', 'hex'),
  } as Express.Multer.File;

  it('enforces ownership, saves image via UploadsService, and appends MediaItem to BlogPost.images', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const imageId = new Types.ObjectId();
    const uploadedAt = new Date('2026-11-19T12:00:00.000Z');

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
      }),
    });

    const mediaItem = {
      url: '/uploads/blog-posts/uuid.png',
      filename: 'uuid.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      uploadedAt,
    };
    mockUploadsService.saveImage.mockResolvedValue(mediaItem);
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        images: [{ _id: imageId, ...mediaItem }],
      }),
    });

    const result = await service.uploadPostImage(
      postId.toHexString(),
      authorId.toHexString(),
      sampleFile,
    );

    expect(mockUploadsService.saveImage).toHaveBeenCalledWith(
      sampleFile,
      'blog-posts',
    );
    expect(result.image.id).toBe(imageId.toHexString());
    expect(result.image.url).toBe('/uploads/blog-posts/uuid.png');
    expect(result.images).toHaveLength(1);
  });

  it('throws ForbiddenException if requester is not post author without saving file', async () => {
    const postId = new Types.ObjectId();
    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: new Types.ObjectId(),
      }),
    });

    await expect(
      service.uploadPostImage(
        postId.toHexString(),
        new Types.ObjectId().toHexString(),
        sampleFile,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUploadsService.saveImage).not.toHaveBeenCalled();
  });

  it('cleans up saved file if DB update fails or returns null', async () => {
    const postId = new Types.ObjectId();
    const authorId = new Types.ObjectId();

    mockBlogPostModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: postId,
        author: authorId,
      }),
    });
    mockUploadsService.saveImage.mockResolvedValue({
      url: '/uploads/blog-posts/orphan.png',
      filename: 'orphan.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      uploadedAt: new Date(),
    });
    mockBlogPostModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.uploadPostImage(
        postId.toHexString(),
        authorId.toHexString(),
        sampleFile,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(mockUploadsService.deleteImage).toHaveBeenCalledWith(
      '/uploads/blog-posts/orphan.png',
    );
  });

  it('throws BadRequestException when postId is invalid or file is missing', async () => {
    await expect(
      service.uploadPostImage(
        'bad-id',
        new Types.ObjectId().toHexString(),
        sampleFile,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.uploadPostImage(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        undefined,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
