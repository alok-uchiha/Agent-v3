from pydantic import BaseModel, Field



class MessageCreate(BaseModel):
    content:str

class ConversationCreate(BaseModel):
    title: str  = Field(default="New Chat",max_length=120)

class ConversationRename(BaseModel):
    title : str = Field(min_length=1, max_length=120)

class ChatRequest(BaseModel):
    content : str = Field(min_length=1)