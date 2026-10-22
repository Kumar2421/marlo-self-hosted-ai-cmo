-- Security: a hosted user could save a custom base_url for groq/mistral with no
-- API key of their own. LLM routes then fell back to the operator's platform key
-- while still sending it to that base_url. The app now refuses such saves and
-- never pairs a user base_url with the platform key; this clears any rows
-- already saved that way. Idempotent. Rows with the user's own key
-- (api_key_secret_id not null) are untouched.
update public.provider_connections
   set base_url = null
 where provider_id in ('groq', 'mistral')
   and base_url is not null
   and api_key_secret_id is null;
