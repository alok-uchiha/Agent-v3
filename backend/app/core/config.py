import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URI=os.getenv("DATABASE")
SECRET_KEY=os.getenv("SECRET_KEY")
OPENROUTER_API_KEY=os.getenv("OPENROUTER_API_KEY")
ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTE=30
