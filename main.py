from fastapi import FastAPI, Request, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import sqlite3
import json
from datetime import datetime, date
import os
from dotenv import load_dotenv
from openai import AsyncOpenAI
from typing import Optional, List, Dict
import asyncio
import websockets
import base64
import logging

# Load environment variables
load_dotenv()

app = FastAPI(title="Journal App", description="AI-powered journaling assistant")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Initialize OpenAI client
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Configuration Constants
class JournalPrompts:
    """Centralized prompt definitions"""
    
    BASE_PROMPTS = {
        "reflection": """You are a thoughtful journaling assistant helping someone reflect on their day. 
        Ask open-ended questions that encourage deep thinking about experiences, emotions, and lessons learned. 
        Be empathetic, curious, and help them process their thoughts. Keep responses concise but meaningful.""",
        
        "planning": """You are a planning assistant helping someone organize their thoughts for upcoming days/weeks. 
        Help them set realistic goals, prioritize tasks, and think through potential challenges. 
        Ask clarifying questions about their intentions and help them create actionable plans.""",
        
        "notes": """You are a note-taking assistant helping someone do a brain dump. 
        Help them organize their thoughts, capture all items, and structure their ideas clearly. 
        Ask clarifying questions to ensure nothing is missed.""",
        
        "goals": """You are a goal-tracking assistant. Help review previous goals, assess progress, 
        and set new objectives. Be encouraging but realistic about what can be accomplished."""
    }
    
    VOICE_PROMPTS = {
        "reflection": """You are a thoughtful journaling assistant helping someone reflect on their day while they're driving. 
        Keep responses conversational and concise. Ask one question at a time. Be empathetic and encouraging. 
        Help them process their thoughts safely while driving.""",
        
        "planning": """You are a planning assistant helping someone organize their thoughts for upcoming days while driving. 
        Keep responses brief and focused. Help them set realistic goals and think through challenges. 
        Ask clarifying questions one at a time.""",
        
        "notes": """You are a note-taking assistant helping someone do a brain dump while driving. 
        Help them organize their thoughts clearly. Acknowledge what they've shared and ask for clarification when needed. 
        Keep responses short and conversational.""",
        
        "goals": """You are a goal-tracking assistant helping someone review and set goals while driving. 
        Be encouraging and realistic. Keep responses brief and ask one question at a time. 
        Help them think through their objectives safely."""
    }
    
    INITIAL_MESSAGES = {
        "reflection": "Hi! I'm here to help you reflect on your day. What's been on your mind today?",
        "planning": "Let's plan ahead! What are you thinking about for tomorrow or the coming days?",
        "notes": "Ready for a brain dump! Tell me everything that's on your mind - I'll help you organize it.",
        "goals": "Let's talk about your goals. What would you like to work on or review?"
    }

class VoiceConfig:
    """Voice session configuration constants"""
    DEFAULT_VOICE = "coral" #alloy, ash, ballad, coral, echo, sage, shimmer, and verse
    DEFAULT_MODEL = "gpt-4.1"
    DEFAULT_VOICE_MODEL = "gpt-4o-realtime-preview"#-2024-10-01"
    AUDIO_FORMAT = "pcm16"
    MAX_TOKENS = 300
    TEMPERATURE = 0.7

# Helper Functions
def get_session_prompt(session_type: str, is_voice: bool = False) -> str:
    """Get the appropriate prompt for session type and context"""
    prompts = JournalPrompts.VOICE_PROMPTS if is_voice else JournalPrompts.BASE_PROMPTS
    return prompts.get(session_type, prompts["reflection"])

def parse_ai_prompts(ai_prompts_json: str) -> List[Dict]:
    """Centralized AI prompt parsing logic"""
    if not ai_prompts_json:
        return []
    
    try:
        parsed_prompts = json.loads(ai_prompts_json)
        if isinstance(parsed_prompts, list):
            return parsed_prompts
        elif isinstance(parsed_prompts, dict):
            return [parsed_prompts]
    except json.JSONDecodeError:
        pass
    
    return []

class JournalDB:
    """Database helper functions"""
    
    @staticmethod
    def get_recent_entries(session_type: str, limit: int = 3) -> List[tuple]:
        """Get recent entries of the specified type"""
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                """SELECT content, ai_prompts, date FROM entries 
                WHERE (type = ? OR type = ?) 
                ORDER BY created_at DESC LIMIT ?""",
                (session_type, f"voice_{session_type}", limit)
            )
            return cursor.fetchall()
        finally:
            conn.close()
    
    @staticmethod
    def save_entry(content: str, entry_type: str, ai_response: str):
        """Save journal entry to database"""
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        try:
            today = date.today().isoformat()
            ai_data = json.dumps([{
                "user": content, 
                "ai": ai_response, 
                "timestamp": datetime.now().isoformat()
            }])
            
            cursor.execute(
                "INSERT INTO entries (date, type, content, ai_prompts) VALUES (?, ?, ?, ?)",
                (today, entry_type, content, ai_data)
            )
            conn.commit()
        finally:
            conn.close()
    
    @staticmethod
    def get_summary(session_type: str) -> Optional[tuple]:
        """Get the most recent summary for a session type"""
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                "SELECT summary_text, key_themes, mentioned_goals FROM summaries WHERE session_type = ? ORDER BY updated_at DESC LIMIT 1",
                (session_type,)
            )
            return cursor.fetchone()
        finally:
            conn.close()
    
    @staticmethod
    def save_summary(session_type: str, summary_text: str, key_themes: List[str], mentioned_goals: List[str], entry_count: int):
        """Save a generated summary"""
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        try:
            today = date.today().isoformat()
            cursor.execute(
                """INSERT OR REPLACE INTO summaries 
                (session_type, summary_text, key_themes, mentioned_goals, entry_count, last_entry_date, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_type,
                    summary_text,
                    json.dumps(key_themes),
                    json.dumps(mentioned_goals),
                    entry_count,
                    today,
                    datetime.now().isoformat()
                )
            )
            conn.commit()
        finally:
            conn.close()
    
    @staticmethod
    def count_entries(session_type: str) -> int:
        """Count entries of a specific type"""
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                "SELECT COUNT(*) FROM entries WHERE (type = ? OR type = ?)",
                (session_type, f"voice_{session_type}")
            )
            return cursor.fetchone()[0]
        finally:
            conn.close()
    
    @staticmethod
    def has_recent_summary(session_type: str) -> bool:
        """Check if there's a summary from the last week"""
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                "SELECT COUNT(*) FROM summaries WHERE session_type = ? AND updated_at > datetime('now', '-7 days')",
                (session_type,)
            )
            return cursor.fetchone()[0] > 0
        finally:
            conn.close()

# Database setup
def init_db():
    conn = sqlite3.connect('journal.db')
    cursor = conn.cursor()
    
    # Create entries table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            type TEXT NOT NULL,  -- 'reflection', 'planning', 'notes', 'goals'
            content TEXT NOT NULL,
            ai_prompts TEXT,  -- JSON string of AI prompts/responses
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create goals table for tracking recurring goals
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_text TEXT NOT NULL,
            created_date TEXT NOT NULL,
            status TEXT DEFAULT 'active',  -- 'active', 'completed', 'paused'
            last_mentioned TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create summaries table for historical context
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_type TEXT NOT NULL,
            summary_text TEXT NOT NULL,
            key_themes TEXT,  -- JSON array of key themes
            mentioned_goals TEXT,  -- JSON array of goals mentioned
            entry_count INTEGER DEFAULT 0,  -- Number of entries summarized
            last_entry_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

class JournalAgent:
    def __init__(self):
        self.conversation_history = []
        self.current_session_type = None
        
    async def get_ai_response(self, user_message: str, session_type: str = "reflection") -> str:
        """Get AI response based on session type and conversation history with previous sessions"""
        try:
            # Build context with historical information
            context_messages = await self.build_context_with_history(session_type)
            
            # Add current conversation history
            for msg in self.conversation_history[-6:]:  # Keep last 6 messages for context
                context_messages.append(msg)
            
            # Add current user message
            context_messages.append({"role": "user", "content": user_message})
            
            response = await client.chat.completions.create(
                model=VoiceConfig.DEFAULT_MODEL,
                messages=context_messages,
                max_tokens=VoiceConfig.MAX_TOKENS,
                temperature=VoiceConfig.TEMPERATURE
            )
            
            ai_response = response.choices[0].message.content
            
            # Update conversation history
            self.conversation_history.append({"role": "user", "content": user_message})
            self.conversation_history.append({"role": "assistant", "content": ai_response})
            
            return ai_response
            
        except Exception as e:
            return f"I'm having trouble connecting right now. Let's continue with your journaling - what's on your mind? (Error: {str(e)})"
    
    async def build_context_with_history(self, session_type: str) -> List[Dict]:
        """Build context messages including historical information from previous sessions"""
        # Start with base system prompt
        system_content = get_session_prompt(session_type, is_voice=False)
        
        # Get historical summary if available
        historical_summary = await self.get_historical_summary(session_type)
        if historical_summary:
            system_content += f"\n\nPrevious context: {historical_summary}"
        
        # Get recent entries for immediate context
        recent_context = await self.get_recent_context(session_type)
        if recent_context:
            system_content += f"\n\nRecent conversations: {recent_context}"
        
        return [{"role": "system", "content": system_content}]
    
    async def get_historical_summary(self, session_type: str) -> Optional[str]:
        """Get or generate historical summary for the session type"""
        result = JournalDB.get_summary(session_type)
        
        if result:
            summary_text, key_themes, mentioned_goals = result
            
            # Parse JSON fields
            themes = json.loads(key_themes) if key_themes else []
            goals = json.loads(mentioned_goals) if mentioned_goals else []
            
            # Build comprehensive summary
            context_parts = [summary_text]
            
            if themes:
                context_parts.append(f"Key themes: {', '.join(themes)}")
            
            if goals:
                context_parts.append(f"Goals mentioned: {', '.join(goals)}")
            
            return " | ".join(context_parts)
        
        # If no summary exists, check if we should generate one
        await self.maybe_generate_summary(session_type)
        return None
    
    async def get_recent_context(self, session_type: str, limit: int = 3) -> Optional[str]:
        """Get condensed context from recent entries of the same type"""
        entries = JournalDB.get_recent_entries(session_type, limit)
        
        if not entries:
            return None
        
        context_parts = []
        for content, ai_prompts_json, entry_date in entries:
            # Extract key points from the entry
            key_points = content[:200] + "..." if len(content) > 200 else content
            
            # Try to get AI's key response
            ai_summary = ""
            ai_prompts = parse_ai_prompts(ai_prompts_json)
            
            if ai_prompts:
                # Get the last AI response from the conversation
                for prompt in reversed(ai_prompts):
                    if isinstance(prompt, dict):
                        if prompt.get('ai'):
                            ai_summary = prompt['ai'][:150] + "..." if len(prompt['ai']) > 150 else prompt['ai']
                            break
                        elif prompt.get('role') == 'assistant' and prompt.get('content'):
                            ai_summary = prompt['content'][:150] + "..." if len(prompt['content']) > 150 else prompt['content']
                            break
            
            context_parts.append(f"[{entry_date}] You: {key_points}")
            if ai_summary:
                context_parts.append(f"AI: {ai_summary}")
        
        return " | ".join(context_parts)
    
    async def maybe_generate_summary(self, session_type: str):
        """Generate a summary if we have enough entries and no recent summary"""
        entry_count = JournalDB.count_entries(session_type)
        
        # Generate summary if we have 5+ entries and no summary from last week
        if entry_count >= 5 and not JournalDB.has_recent_summary(session_type):
            await self.generate_summary(session_type)
    
    async def generate_summary(self, session_type: str):
        """Generate a summary of historical entries for the session type"""
        try:
            # Get older entries (skip the most recent 3 to avoid duplicating recent context)
            conn = sqlite3.connect('journal.db')
            cursor = conn.cursor()
            
            cursor.execute(
                """SELECT content, ai_prompts, date FROM entries 
                WHERE (type = ? OR type = ?) 
                ORDER BY created_at DESC LIMIT 20 OFFSET 3""",
                (session_type, f"voice_{session_type}")
            )
            
            entries = cursor.fetchall()
            conn.close()
            
            if len(entries) < 3:  # Need at least 3 entries to summarize
                return
            
            # Prepare content for summarization
            content_for_summary = []
            for content, ai_prompts_json, entry_date in entries:
                content_for_summary.append(f"[{entry_date}] {content}")
            
            combined_content = "\n\n".join(content_for_summary)
            
            # Generate summary using AI
            summary_prompt = f"""Please create a concise summary of these {session_type} journal entries. Focus on:
1. Key recurring themes and patterns
2. Important goals or objectives mentioned
3. Progress or changes over time
4. Any significant insights or breakthroughs

Entries:
{combined_content}

Provide a summary in 2-3 sentences, followed by key themes (comma-separated) and any goals mentioned (comma-separated)."""

            response = await client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that creates concise summaries of journal entries."},
                    {"role": "user", "content": summary_prompt}
                ],
                max_tokens=VoiceConfig.MAX_TOKENS,
                temperature=0.3
            )
            
            summary_response = response.choices[0].message.content
            
            # Parse the response to extract themes and goals
            lines = summary_response.split('\n')
            summary_text = lines[0] if lines else summary_response
            
            key_themes = []
            mentioned_goals = []
            
            for line in lines:
                if 'themes:' in line.lower():
                    themes_text = line.split(':', 1)[1].strip()
                    key_themes = [theme.strip() for theme in themes_text.split(',')]
                elif 'goals:' in line.lower():
                    goals_text = line.split(':', 1)[1].strip()
                    mentioned_goals = [goal.strip() for goal in goals_text.split(',')]
            
            # Save summary using helper
            JournalDB.save_summary(session_type, summary_text, key_themes, mentioned_goals, len(entries))
            print(f"Generated summary for {session_type}: {len(entries)} entries")
            
        except Exception as e:
            print(f"Error generating summary: {e}")

# Global agent instance
journal_agent = JournalAgent()

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Main journal interface"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/chat")
async def chat(request: Request):
    """Handle chat messages"""
    data = await request.json()
    user_message = data.get("message", "")
    session_type = data.get("type", "reflection")
    
    if not user_message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    # Get AI response
    ai_response = await journal_agent.get_ai_response(user_message, session_type)
    
    # Save to database using helper
    JournalDB.save_entry(user_message, session_type, ai_response)
    
    return JSONResponse({
        "response": ai_response,
        "timestamp": datetime.now().isoformat()
    })

@app.get("/entries")
async def get_entries(date_filter: Optional[str] = None):
    """Get journal entries, optionally filtered by date"""
    conn = sqlite3.connect('journal.db')
    cursor = conn.cursor()
    
    if date_filter:
        cursor.execute(
            "SELECT * FROM entries WHERE date = ? ORDER BY created_at DESC",
            (date_filter,)
        )
    else:
        cursor.execute("SELECT * FROM entries ORDER BY created_at DESC LIMIT 50")
    
    entries = cursor.fetchall()
    conn.close()
    
    # Convert to list of dictionaries
    entry_list = []
    for entry in entries:
        # Parse ai_prompts JSON safely
        ai_prompts = []
        if entry[4]:
            try:
                parsed_prompts = json.loads(entry[4])
                # Handle different formats of stored data
                if isinstance(parsed_prompts, list):
                    ai_prompts = parsed_prompts
                elif isinstance(parsed_prompts, dict):
                    # Convert single conversation to list format
                    ai_prompts = [parsed_prompts]
            except json.JSONDecodeError:
                ai_prompts = []
        
        entry_dict = {
            "id": entry[0],
            "date": entry[1],
            "type": entry[2],
            "content": entry[3],
            "ai_prompts": ai_prompts,
            "created_at": entry[5],
            "updated_at": entry[6]
        }
        entry_list.append(entry_dict)
    
    return JSONResponse(entry_list)

@app.get("/browse")
async def browse_entries(request: Request):
    """Browse entries by date"""
    return templates.TemplateResponse("browse.html", {"request": request})

# save_entry function removed - using JournalDB.save_entry helper instead

@app.post("/start-session")
async def start_session(request: Request):
    """Start a new journaling session"""
    data = await request.json()
    session_type = data.get("type", "reflection")
    
    # Reset conversation history for new session
    journal_agent.conversation_history = []
    journal_agent.current_session_type = session_type
    
    # Get initial message using centralized prompts
    initial_message = JournalPrompts.INITIAL_MESSAGES.get(session_type, JournalPrompts.INITIAL_MESSAGES["reflection"])
    
    return JSONResponse({
        "message": initial_message,
        "session_type": session_type
    })

# VoiceSession class removed - functionality consolidated into voice_websocket function

@app.websocket("/voice")
async def voice_websocket(websocket: WebSocket):
    """WebSocket relay to OpenAI Realtime API"""
    await websocket.accept()
    
    openai_ws = None
    conversation_transcript = []
    session_type = "reflection"
    awaiting_response = False
    
    try:
        # Get API key
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "OpenAI API key not configured"
            }))
            return
        
        # Wait for session configuration from client
        config_data = await websocket.receive_text()
        config = json.loads(config_data)
        session_type = config.get("session_type", "reflection")
        
        print(f"Starting voice session: {session_type}")
        
        # Connect to OpenAI Realtime API with proper headers
        headers = {
            "Authorization": f"Bearer {api_key}",
            "OpenAI-Beta": "realtime=v1"
        }
        
        openai_ws = await websockets.connect(
            f"wss://api.openai.com/v1/realtime?model={VoiceConfig.DEFAULT_VOICE_MODEL}",
            extra_headers=headers
        )
        
        print("Connected to OpenAI Realtime API")
        
        # Send session configuration to OpenAI using centralized config
        session_config = {
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": get_session_prompt(session_type, is_voice=True),
                "voice": VoiceConfig.DEFAULT_VOICE,
                "input_audio_format": VoiceConfig.AUDIO_FORMAT,
                "output_audio_format": VoiceConfig.AUDIO_FORMAT,
                "input_audio_transcription": {
                    "model": "whisper-1"
                },
                "temperature": VoiceConfig.TEMPERATURE,
                "max_response_output_tokens": VoiceConfig.MAX_TOKENS
            }
        }
        
        await openai_ws.send(json.dumps(session_config))
        
        # Send ready signal to client
        await websocket.send_text(json.dumps({
            "type": "ready",
            "message": "Voice session ready"
        }))
        
        # Relay messages bidirectionally
        async def relay_from_openai():
            """Relay messages from OpenAI to client"""
            nonlocal awaiting_response
            try:
                async for message in openai_ws:
                    # Forward binary frames directly
                    if isinstance(message, (bytes, bytearray)):
                        await websocket.send_bytes(message)
                        continue

                    # Parse JSON text frames
                    try:
                        data = json.loads(message)
                    except Exception as e:
                        logging.exception("Error parsing OpenAI message: %s", e)
                        await websocket.send_text(message)
                        continue

                    print(f"OpenAI → Client: {data.get('type', 'unknown')}")
                    
                    # Auto-create a response when audio buffer is committed if client didn't request yet
                    if data.get("type") == "input_audio_buffer.committed" and not awaiting_response:
                        try:
                            await openai_ws.send(json.dumps({
                                "type": "response.create",
                                "response": {"modalities": ["text", "audio"]}
                            }))
                            awaiting_response = True
                            print("Server → OpenAI: response.create (auto after commit)")
                        except Exception as e:
                            print(f"Failed to send response.create: {e}")
                    
                    # Clear awaiting flag when response completes/finishes
                    if data.get("type") in (
                        "response.completed",
                        "response.audio.done",
                        "response.output_audio.done",
                        "response.text.done",
                        "response.output_text.done"
                    ):
                        awaiting_response = False
                    
                    # Save transcripts for later
                    if data.get("type") == "conversation.item.input_audio_transcription.completed":
                        transcript = data.get("transcript", "")
                        conversation_transcript.append({
                            "role": "user",
                            "content": transcript,
                            "timestamp": datetime.now().isoformat()
                        })
                        
                    elif data.get("type") == "response.text.done":
                        response_text = data.get("text", "")
                        conversation_transcript.append({
                            "role": "assistant", 
                            "content": response_text,
                            "timestamp": datetime.now().isoformat()
                        })
                    
                    # Forward all messages to client
                    await websocket.send_text(message)
                    
            except websockets.exceptions.ConnectionClosed:
                print("OpenAI WebSocket closed")
            except Exception as e:
                print(f"Error relaying from OpenAI: {e}")
        
        # Start relaying from OpenAI
        relay_task = asyncio.create_task(relay_from_openai())
        
        # Handle client messages and relay to OpenAI
        try:
            while True:
                message = await websocket.receive()
                
                if message["type"] == "websocket.disconnect":
                    break
                    
                elif message["type"] == "websocket.receive":
                    if "bytes" in message:
                        # Audio data from client - relay to OpenAI
                        audio_data = message["bytes"]
                        print(f"Client → OpenAI: {len(audio_data)} bytes audio")
                        await openai_ws.send(audio_data)
                        
                    elif "text" in message:
                        # Text messages from client - relay to OpenAI
                        text_data = message["text"]
                        print(f"Client → OpenAI: {text_data}")
                        # Track when client asks to create a response
                        try:
                            payload = json.loads(text_data)
                            if isinstance(payload, dict) and payload.get("type") == "response.create":
                                awaiting_response = True
                        except Exception:
                            pass
                        await openai_ws.send(text_data)
                        
        except WebSocketDisconnect:
            print("Client disconnected")
        finally:
            relay_task.cancel()
            
    except Exception as e:
        print(f"Voice WebSocket error: {e}")
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": str(e)
        }))
    finally:
        # Save conversation transcript
        if conversation_transcript:
            await save_voice_transcript(conversation_transcript, session_type)
        
        # Close OpenAI connection
        if openai_ws:
            await openai_ws.close()

async def save_voice_transcript(transcript, session_type):
    """Save voice conversation transcript to database"""
    try:
        user_content = []
        ai_content = []
        
        for item in transcript:
            if item["role"] == "user":
                user_content.append(item["content"])
            else:
                ai_content.append(item["content"])
        
        if user_content:  # Only save if there's actual content
            full_transcript = json.dumps(transcript)
            user_summary = " ".join(user_content)
            
            conn = sqlite3.connect('journal.db')
            cursor = conn.cursor()
            
            today = date.today().isoformat()
            
            cursor.execute(
                "INSERT INTO entries (date, type, content, ai_prompts) VALUES (?, ?, ?, ?)",
                (today, f"voice_{session_type}", user_summary, full_transcript)
            )
            
            conn.commit()
            conn.close()
            print(f"Saved voice transcript: {len(user_content)} user messages")
            
    except Exception as e:
        print(f"Error saving voice transcript: {e}")

# save_voice_session function removed - unused after VoiceSession class removal

@app.get("/voice-mode")
async def voice_mode(request: Request):
    """Voice mode interface"""
    return templates.TemplateResponse("voice.html", {"request": request})

@app.get("/api/get-openai-key")
async def get_openai_key():
    """Get OpenAI API key for frontend"""
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        return JSONResponse({"key": api_key})
    else:
        return JSONResponse({"key": None, "error": "API key not found"})

@app.post("/api/clear-database")
async def clear_database():
    """Clear all journal entries from the database"""
    try:
        conn = sqlite3.connect('journal.db')
        cursor = conn.cursor()
        
        # Clear entries table
        cursor.execute("DELETE FROM entries")
        
        # Clear goals table
        cursor.execute("DELETE FROM goals")
        
        # Reset auto-increment counters
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='entries'")
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='goals'")
        
        conn.commit()
        conn.close()
        
        return JSONResponse({"success": True, "message": "Database cleared successfully"})
        
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
