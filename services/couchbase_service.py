import os
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions
from couchbase.auth import PasswordAuthenticator
from dotenv import load_dotenv

load_dotenv()

class CouchbaseService:
    _instance = None
    _cluster = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CouchbaseService, cls).__new__(cls)
            cls._initialize_cluster()
        return cls._instance

    @classmethod
    def _initialize_cluster(cls):
        conn_str = os.getenv("CB_CONNECTION_STRING")
        username = os.getenv("CB_USERNAME")
        password = os.getenv("CB_PASSWORD")
        
        auth = PasswordAuthenticator(username, password)
        cls._cluster = Cluster(conn_str, ClusterOptions(auth))

    @classmethod
    def get_cluster(cls):
        if cls._cluster is None:
            cls._initialize_cluster()
        return cls._cluster

# --- UNIT TEST ---
if __name__ == "__main__":
    print("🚀 Testing Couchbase Connection...")
    try:
        cluster = CouchbaseService.get_cluster()
        # Try a simple diagnostic ping
        cluster.ping()
        print("✅ SUCCESS: Ccouchbase Server is online and reachable!")
    except Exception as e:
        print(f"❌ FAILED: Could not connect. Check your .env and IP allow-list.\nError: {e}")
