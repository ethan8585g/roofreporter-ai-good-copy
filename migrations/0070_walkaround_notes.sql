-- Voice walkaround support: audio storage, transcription, and AI-organized notes
ALTER TABLE job_progress ADD COLUMN audio_data TEXT;
ALTER TABLE job_progress ADD COLUMN transcription TEXT;
ALTER TABLE job_progress ADD COLUMN ai_notes TEXT;
