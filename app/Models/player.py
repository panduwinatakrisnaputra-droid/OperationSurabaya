from pydantic import BaseModel, Field

class PlayerRegister(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    full_name: str = Field(min_length=2, max_length=100)
    email: str
    password: str = Field(min_length=8)


class PlayerLogin(BaseModel):
    email: str
    password: str = Field(min_length=8)


class PlayerLogout(BaseModel):
    access_token: str
