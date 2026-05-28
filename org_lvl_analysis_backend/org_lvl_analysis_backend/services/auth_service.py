# services/auth_service.py
from typing import Optional
from fastapi import HTTPException, status

# Replace with your existing users
VALID_USERS = {
    "aishwaryajain": "shwryjn",
    "dmirakhur": "dmrkhr",
    "sparashar": "sprshr",
    "abhishek.singh": "bhshksngh",
    "varun.singh": "vrnsngh",
    "ankit.arora": "nktrr",
    "jnad": "jytsnd>",
    "sroutray": "srtry>",
    "a.goel": "dtygl",
    "ppruthi": "pprth",
    "arao": "bhnvr",
    "rraj": "rhlrj",
    "ashish.mehta": "shshmht",
    "hmakkar": "hmkkr",
    "gbhatia": "gbht",
    "abhay.nigam": "bhyngm",
    "sherry.shaju": "shrryshj",
    "singh.vani": "snghn",
}

def authenticate_user(username: str, password: str) -> bool:
    if username in VALID_USERS and VALID_USERS[username] == password:
        return True
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")