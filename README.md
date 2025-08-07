# AI-Powered Journal App

A chat-based journaling application that uses AI to help you reflect on your day, plan ahead, organize thoughts, and track goals.

## Features

- **Daily Reflection**: AI-guided conversations to help you process your day
- **Planning**: Organize thoughts for upcoming days and weeks
- **Brain Dump**: Capture and structure all your ideas and thoughts
- **Goal Tracking**: Set and review personal goals with AI assistance
- **Voice Mode**: Hands-free continuous listening for journaling while driving
- **Browse Entries**: View and filter past journal entries by date
- **Responsive Design**: Works on desktop and mobile devices

## Setup Instructions

### 1. Install Dependencies

First, make sure you have Python 3.8+ installed. Then install the required packages:

```bash
pip install -r requirements.txt
```

### 2. Set up OpenAI API Key

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit the `.env` file and add your OpenAI API key:
```
OPENAI_API_KEY=your_actual_openai_api_key_here
```

You can get an API key from [OpenAI's website](https://platform.openai.com/api-keys).

### 3. Run the Application

Start the FastAPI server:

```bash
python main.py
```

Or use uvicorn directly:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Access the App

Open your web browser and go to:
```
http://localhost:8000
```

**Important for Voice Mode**: Chrome requires HTTPS for microphone access when not on localhost. Since we're running on localhost (127.0.0.1), voice mode should work properly. If you encounter microphone access issues, make sure you're accessing the app via `http://localhost:8000` or `http://127.0.0.1:8000`, not `http://0.0.0.0:8000`.

## Usage

### Journaling Sessions

1. **Daily Reflection**: Click the "Daily Reflection" tab to start reflecting on your day
2. **Planning**: Use the "Planning" tab to organize thoughts for future days
3. **Brain Dump**: Select "Brain Dump" when you need to capture lots of ideas quickly
4. **Goals**: Use the "Goals" tab to work on personal objectives

### Features

- **New Session**: Click "New Session" to start fresh with a new conversation
- **Voice Mode**: Click "🎤 Voice Mode" for hands-free continuous listening journaling
- **Browse Entries**: Click "Browse Entries" to view past journal entries
- **Date Filtering**: In the browse view, filter entries by specific dates

### Voice Mode (Driving Mode)

The voice mode provides a hands-free journaling experience perfect for use while driving:

1. **Access Voice Mode**: Click the "🎤 Voice Mode" button from the main interface
2. **Choose Session Type**: Select your journaling mode (Reflection, Planning, Brain Dump, or Goals)
3. **Grant Microphone Permission**: Allow the app to access your microphone
4. **Start Conversing**: The AI will greet you and start the conversation
5. **Continuous Listening**: The app uses voice activity detection to know when you're speaking
6. **Real-time Transcription**: See your words transcribed in real-time
7. **AI Voice Responses**: The AI responds with natural speech
8. **Session Controls**: Use Mute, Pause, or End buttons as needed

**Voice Mode Features:**
- **Continuous Listening**: No need to press buttons - just speak naturally
- **Voice Activity Detection**: Automatically detects when you start and stop speaking
- **Real-time Audio Visualization**: Visual feedback showing audio levels
- **Live Transcription**: See your conversation transcribed in real-time
- **AI Voice Responses**: Natural speech responses from the AI assistant
- **Session Management**: Pause, mute, or end sessions with large, easy-to-reach buttons
- **Auto-save**: Conversations are automatically saved to your journal
- **Keyboard Shortcuts**: Space to pause/resume, Ctrl+M to mute, Escape to end

**Safety Features for Driving:**
- Large, high-contrast buttons for easy visibility
- Voice-only interaction - no need to look at screen
- Audio cues for state changes
- Hands-free operation throughout the session

## Data Storage

- Journal entries are stored in a local SQLite database (`journal.db`)
- Each entry includes the conversation with the AI assistant
- Entries are organized by date and type for easy browsing

## Future Enhancements

- Voice input using speech-to-text
- Goal tracking with progress monitoring
- Export functionality (PDF, text)
- Mobile app version
- Advanced search and filtering
- Data backup and sync

## Technical Details

- **Backend**: FastAPI (Python)
- **Frontend**: HTML, CSS, JavaScript
- **Database**: SQLite
- **AI**: OpenAI GPT-4
- **Styling**: Modern CSS with responsive design

## Project Structure

```
journal/
├── main.py              # FastAPI backend with WebSocket support
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variables template
├── templates/          # HTML templates
│   ├── index.html      # Main journal interface
│   ├── browse.html     # Browse entries page
│   └── voice.html      # Voice mode interface
├── static/             # Static assets
│   ├── style.css       # Main app styles
│   ├── voice.css       # Voice mode styles
│   ├── app.js          # Main app JavaScript
│   ├── browse.js       # Browse page JavaScript
│   └── voice.js        # Voice mode JavaScript
└── README.md           # This file
```

## Troubleshooting

1. **OpenAI API Errors**: Make sure your API key is valid and you have credits
2. **Database Issues**: Delete `journal.db` to reset the database
3. **Port Conflicts**: Change the port in `main.py` if 8000 is already in use
4. **Dependencies**: Make sure all packages in `requirements.txt` are installed

## Contributing

This is a prototype journaling app. Feel free to extend it with additional features like:
- Integration with other AI models
- Advanced goal tracking
- Data visualization
- Export/import functionality
- Mobile app development
