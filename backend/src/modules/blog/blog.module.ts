import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { UsersModule } from '../users/users.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { BlogPost, BlogPostSchema } from './schemas/blog-post.schema';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Tag, TagSchema } from './schemas/tag.schema';

@Module({
  imports: [
    ItinerariesModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      { name: Tag.name, schema: TagSchema },
    ]),
  ],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
