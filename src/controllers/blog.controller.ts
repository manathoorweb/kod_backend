import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface ListBlogQuery {
  categorySlug?: string;
  limit?: string;
  search?: string;
}

interface SlugParams {
  slug: string;
}

interface IdParams {
  id: string;
}

interface AddCommentBody {
  authorName: string;
  authorEmail: string;
  content: string;
}

/**
 * Get all published blog posts, optionally filtered by category
 */
export async function listBlogPosts(request: FastifyRequest, reply: FastifyReply) {
  const { categorySlug, limit, search } = request.query as ListBlogQuery;
  const limitVal = limit ? parseInt(limit, 10) : null;

  try {
    let queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
             json_build_object('id', a.id, 'name', a.name, 'avatar_url', a.avatar) as author
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_authors a ON p.author_id = a.id
      WHERE p.status = 'published'
    `;
    const queryParams: any[] = [];

    if (categorySlug) {
      queryParams.push(categorySlug);
      queryText += ` AND c.slug = $${queryParams.length}`;
    }

    if (search) {
      queryParams.push(`%${search}%`);
      queryText += ` AND (p.title ILIKE $${queryParams.length} OR p.excerpt ILIKE $${queryParams.length} OR p.content ILIKE $${queryParams.length})`;
    }

    queryText += ' ORDER BY p.published_at DESC, p.created_at DESC';

    if (limitVal && !isNaN(limitVal)) {
      queryParams.push(limitVal);
      queryText += ` LIMIT $${queryParams.length}`;
    }

    const postsRes = await pool.query(queryText, queryParams);
    return reply.send(postsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog posts' });
  }
}

/**
 * Get a single blog post by its slug
 */
export async function getBlogPostBySlug(request: FastifyRequest, reply: FastifyReply) {
  const { slug } = request.params as SlugParams;

  try {
    const queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
             json_build_object('id', a.id, 'name', a.name, 'avatar_url', a.avatar, 'bio', a.bio) as author
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_authors a ON p.author_id = a.id
      WHERE p.slug = $1 AND p.status = 'published'
    `;
    const postRes = await pool.query(queryText, [slug]);
    
    if (postRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Blog post not found' });
    }
    
    return reply.send(postRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog post details' });
  }
}

/**
 * Get the single featured blog post
 */
export async function getFeaturedBlogPost(request: FastifyRequest, reply: FastifyReply) {
  try {
    const queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
             json_build_object('id', a.id, 'name', a.name, 'avatar_url', a.avatar) as author
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_authors a ON p.author_id = a.id
      WHERE p.featured = true AND p.status = 'published'
      ORDER BY p.published_at DESC, p.created_at DESC
      LIMIT 1
    `;
    const postRes = await pool.query(queryText);
    
    if (postRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Featured blog post not found' });
    }
    
    return reply.send(postRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve featured blog post' });
  }
}

/**
 * Get popular blog posts
 */
export async function getPopularBlogPosts(request: FastifyRequest, reply: FastifyReply) {
  const { limit } = request.query as ListBlogQuery;
  const limitVal = limit ? parseInt(limit, 10) : 5;

  try {
    const queryText = `
      SELECT p.*, 
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      WHERE p.status = 'published'
      ORDER BY p.views_count DESC
      LIMIT $1
    `;
    const postsRes = await pool.query(queryText, [limitVal]);
    return reply.send(postsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve popular blog posts' });
  }
}

/**
 * Increment views count of a post
 */
export async function incrementPostViews(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as IdParams;

  try {
    await pool.query(
      'UPDATE blog_posts SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1',
      [id]
    );
    return reply.send({ success: true });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to increment post views' });
  }
}

/**
 * Get all blog categories
 */
export async function listCategories(request: FastifyRequest, reply: FastifyReply) {
  try {
    const categoriesRes = await pool.query('SELECT * FROM blog_categories ORDER BY name ASC');
    return reply.send(categoriesRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog categories' });
  }
}

/**
 * Get comments for a blog post
 */
export async function getBlogPostComments(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as IdParams;

  try {
    const commentsRes = await pool.query(
      'SELECT * FROM blog_editorial_comments WHERE post_id = $1 ORDER BY created_at DESC',
      [id]
    );
    return reply.send(commentsRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve blog comments' });
  }
}

/**
 * Add a comment to a blog post
 */
export async function addCommentToBlogPost(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as IdParams;
  const { authorName, authorEmail, content } = request.body as AddCommentBody;

  try {
    const commentRes = await pool.query(
      `INSERT INTO blog_editorial_comments (post_id, author_name, author_email, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, authorName, authorEmail, content]
    );
    return reply.status(201).send(commentRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to submit comment' });
  }
}
