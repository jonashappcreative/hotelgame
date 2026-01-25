-- Restrict profiles SELECT policy to authenticated users only
-- This prevents anonymous scraping of user profile data

DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "Authenticated users can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);