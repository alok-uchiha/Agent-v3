import os
from dotenv import load_dotenv

from langchain.agents import create_agent
from langchain.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.ai.config.settings import get_setting
from backend.app.ai.prompt.prompt import system_prompt


load_dotenv()
os.environ["OPENROUTER_API_KEY"] = os.getenv("OPENROUTER_API_KEY")

# setting = get_setting()



agent = create_agent(
    model="openrouter:nvidia/nemotron-3-super-120b-a12b:free",
    tools=[],
    system_prompt=system_prompt,
    checkpointer=InMemorySaver()
)

