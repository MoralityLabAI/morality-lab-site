-- Vercel Postgres Schema for GPT Storyworld
-- Run this in Vercel Postgres SQL console or via CLI

-- Create storyworlds table
CREATE TABLE IF NOT EXISTS storyworlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Configuration parameters
  num_characters INTEGER NOT NULL CHECK (num_characters BETWEEN 1 AND 10),
  num_themes INTEGER NOT NULL CHECK (num_themes BETWEEN 1 AND 5),
  num_variables INTEGER NOT NULL CHECK (num_variables BETWEEN 3 AND 20),
  encounter_length INTEGER NOT NULL CHECK (encounter_length BETWEEN 200 AND 1500),
  custom_prompt TEXT,
  
  -- Generated content
  encounter JSONB NOT NULL,
  system_prompt TEXT,
  
  -- Metadata
  is_public BOOLEAN DEFAULT true,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  fork_count INTEGER DEFAULT 0,
  forked_from UUID REFERENCES storyworlds(id) ON DELETE SET NULL,
  
  -- GPT configuration
  model_used VARCHAR(50) DEFAULT 'gpt-4',
  temperature DECIMAL(3,2) DEFAULT 0.8 CHECK (temperature BETWEEN 0 AND 2),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_storyworlds_public 
  ON storyworlds(is_public) 
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_storyworlds_created 
  ON storyworlds(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storyworlds_likes 
  ON storyworlds(likes DESC);

CREATE INDEX IF NOT EXISTS idx_storyworlds_views 
  ON storyworlds(views DESC);

CREATE INDEX IF NOT EXISTS idx_storyworlds_forked_from 
  ON storyworlds(forked_from) 
  WHERE forked_from IS NOT NULL;

-- JSONB index for encounter content searches
CREATE INDEX IF NOT EXISTS idx_storyworlds_encounter_gin 
  ON storyworlds USING GIN (encounter);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to storyworlds table
DROP TRIGGER IF EXISTS update_storyworlds_updated_at ON storyworlds;
CREATE TRIGGER update_storyworlds_updated_at
  BEFORE UPDATE ON storyworlds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: Create full-text search index
CREATE INDEX IF NOT EXISTS idx_storyworlds_search 
  ON storyworlds USING GIN (
    to_tsvector('english', 
      COALESCE(title, '') || ' ' || 
      COALESCE(description, '') || ' ' || 
      COALESCE(custom_prompt, '')
    )
  );

-- Create a view for public storyworlds with additional computed fields
CREATE OR REPLACE VIEW public_storyworlds AS
SELECT 
  id,
  title,
  description,
  num_characters,
  num_themes,
  num_variables,
  encounter_length,
  custom_prompt,
  encounter,
  views,
  likes,
  fork_count,
  forked_from,
  model_used,
  temperature,
  created_at,
  -- Computed engagement score
  (likes * 3 + views + fork_count * 5) as engagement_score,
  -- Time since creation
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as hours_since_creation
FROM storyworlds
WHERE is_public = true;

-- Optional: Create materialized view for analytics (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS storyworld_analytics AS
SELECT 
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as storyworlds_created,
  SUM(views) as total_views,
  SUM(likes) as total_likes,
  AVG(num_characters) as avg_characters,
  AVG(num_themes) as avg_themes,
  AVG(num_variables) as avg_variables,
  AVG(encounter_length) as avg_encounter_length
FROM storyworlds
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_storyworld_analytics_date 
  ON storyworld_analytics(date);

-- Function to refresh analytics (call this periodically via cron or manually)
CREATE OR REPLACE FUNCTION refresh_analytics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY storyworld_analytics;
END;
$$ LANGUAGE plpgsql;

-- Insert some sample data (optional, for testing)
INSERT INTO storyworlds (
  title,
  description,
  num_characters,
  num_themes,
  num_variables,
  encounter_length,
  custom_prompt,
  encounter,
  system_prompt,
  model_used
) VALUES (
  'The Haunted Manor',
  'A gothic horror storyworld set in Victorian England',
  3,
  2,
  5,
  500,
  'Create a spooky atmosphere with supernatural elements',
  '{"encounter": "You stand before the decrepit manor, its windows like hollow eyes staring into your soul. The rusty gate creaks as you push it open, revealing an overgrown path lined with dead roses.", "choices": ["Enter through the front door", "Investigate the basement window", "Circle around to the servants entrance"], "variables_affected": {"fear": 5, "curiosity": 3}, "metadata": {"characters_present": ["Player"], "themes_emphasized": ["horror", "mystery"], "narrative_weight": 8}}'::jsonb,
  'You are a gothic horror storyworld generator...',
  'gpt-4'
);

-- Grant necessary permissions (adjust as needed)
-- Note: Vercel Postgres typically handles this automatically
-- GRANT SELECT, INSERT, UPDATE, DELETE ON storyworlds TO your_app_user;
-- GRANT SELECT ON public_storyworlds TO your_app_user;

-- Verify the setup
SELECT 'Schema created successfully!' as status;
SELECT COUNT(*) as sample_storyworlds FROM storyworlds;
