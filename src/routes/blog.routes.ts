import { FastifyInstance } from 'fastify';
import { 
  listBlogPosts, 
  getBlogPostBySlug, 
  getFeaturedBlogPost, 
  getPopularBlogPosts, 
  incrementPostViews,
  listCategories,
  getBlogPostComments,
  addCommentToBlogPost
} from '../controllers/blog.controller';

export async function blogRoutes(fastify: FastifyInstance) {
  fastify.get('/', listBlogPosts);
  fastify.get('/featured', getFeaturedBlogPost);
  fastify.get('/popular', getPopularBlogPosts);
  fastify.get('/post/:slug', getBlogPostBySlug);
  fastify.get('/categories', listCategories);
  
  // Comments endpoints
  fastify.get('/:id/comments', getBlogPostComments);
  fastify.post('/:id/comments', addCommentToBlogPost);
  
  // Views tracker
  fastify.post('/:id/view', incrementPostViews);
}
