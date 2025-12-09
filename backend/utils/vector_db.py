#!/usr/bin/env python3
"""
Vector Database Service using PostgreSQL with pgvector
Stores analysis data with embeddings for semantic search
"""

import os
import json
from typing import Dict, List, Optional, Any
from datetime import datetime
import traceback

# Optional imports - handle gracefully if not available
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
    from psycopg2.pool import SimpleConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    print("[VectorDB] Warning: psycopg2 not available. Vector DB functionality disabled.")

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    print("[VectorDB] Warning: numpy not available. Vector DB functionality disabled.")

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    print("[VectorDB] Warning: sentence-transformers not available. Vector DB functionality disabled.")

# Initialize sentence transformer model for embeddings
# Using a lightweight model for better performance
EMBEDDING_MODEL = None

def get_embedding_model():
    """Lazy load the embedding model"""
    if not SENTENCE_TRANSFORMERS_AVAILABLE:
        raise ImportError("sentence-transformers is required but not installed")
    
    global EMBEDDING_MODEL
    if EMBEDDING_MODEL is None:
        try:
            # Using a lightweight model - can be changed to larger models for better quality
            EMBEDDING_MODEL = SentenceTransformer('all-MiniLM-L6-v2')
            print("[VectorDB] Loaded embedding model: all-MiniLM-L6-v2")
        except Exception as e:
            print(f"[VectorDB] Error loading embedding model: {e}")
            # Fallback to a smaller model if available
            try:
                EMBEDDING_MODEL = SentenceTransformer('paraphrase-MiniLM-L3-v2')
                print("[VectorDB] Loaded fallback embedding model")
            except Exception as e2:
                print(f"[VectorDB] Failed to load fallback model: {e2}")
                raise
    return EMBEDDING_MODEL

class VectorDB:
    """PostgreSQL with pgvector for storing and searching analysis data"""
    
    def __init__(self):
        """Initialize database connection pool"""
        if not PSYCOPG2_AVAILABLE:
            raise ImportError("psycopg2 is required for VectorDB but is not installed")
        
        # Get database connection details from environment or use defaults
        # On macOS with Homebrew, PostgreSQL uses the current user by default
        import getpass
        default_user = os.getenv('DB_USER', getpass.getuser())
        
        self.db_config = {
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': os.getenv('DB_PORT', '5432'),
            'database': os.getenv('DB_NAME', 'counterfeit_ic'),
            'user': os.getenv('DB_USER', default_user),
            'password': os.getenv('DB_PASSWORD', '')  # No password by default on macOS Homebrew
        }
        
        self.pool = None
        self._ensure_schema()
    
    def _get_connection(self):
        """Get a connection from the pool"""
        if self.pool is None:
            try:
                self.pool = SimpleConnectionPool(
                    minconn=1,
                    maxconn=10,
                    **self.db_config
                )
                print(f"[VectorDB] Created connection pool to {self.db_config['database']}")
            except Exception as e:
                print(f"[VectorDB] Error creating connection pool: {e}")
                print(f"[VectorDB] Database config: {self.db_config}")
                raise
        
        return self.pool.getconn()
    
    def _return_connection(self, conn):
        """Return connection to pool"""
        if self.pool:
            self.pool.putconn(conn)
    
    def _ensure_schema(self):
        """Create database schema and tables if they don't exist"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Enable pgvector extension
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            
            # Create analysis table with vector column
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analysis_history (
                    id SERIAL PRIMARY KEY,
                    session_id VARCHAR(255) UNIQUE NOT NULL,
                    part_number VARCHAR(255),
                    manufacturer VARCHAR(255),
                    package_type VARCHAR(100),
                    pin_count INTEGER,
                    country_of_origin VARCHAR(100),
                    authenticity_score FLOAT,
                    verdict VARCHAR(50),
                    processed_date TIMESTAMP NOT NULL,
                    
                    -- Analysis data stored as JSONB for flexibility
                    metadata JSONB,
                    analysis_data JSONB,
                    tool_outputs JSONB,
                    
                    -- Vector embedding for semantic search
                    embedding vector(384),
                    
                    -- Searchable text content (concatenated from analysis)
                    search_text TEXT,
                    
                    -- Timestamps
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
            # Create indexes for better performance
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_analysis_session_id 
                ON analysis_history(session_id);
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_analysis_processed_date 
                ON analysis_history(processed_date DESC);
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_analysis_verdict 
                ON analysis_history(verdict);
            """)
            
            # Vector similarity search index (HNSW for better performance)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_analysis_embedding 
                ON analysis_history 
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            """)
            
            # Full-text search index on search_text
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_analysis_search_text 
                ON analysis_history 
                USING gin(to_tsvector('english', search_text));
            """)
            
            # Create annotations table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ic_annotations (
                    id SERIAL PRIMARY KEY,
                    session_id VARCHAR(255) NOT NULL,
                    image_path VARCHAR(500) NOT NULL,
                    annotation_id VARCHAR(255) UNIQUE NOT NULL,
                    
                    -- Bounding box coordinates (normalized 0-1)
                    bbox_x FLOAT NOT NULL,
                    bbox_y FLOAT NOT NULL,
                    bbox_width FLOAT NOT NULL,
                    bbox_height FLOAT NOT NULL,
                    
                    -- Annotation metadata
                    label VARCHAR(255),
                    description TEXT,
                    annotation_type VARCHAR(100),
                    severity VARCHAR(20),
                    verified BOOLEAN DEFAULT FALSE,
                    
                    -- User feedback
                    user_id VARCHAR(255),
                    user_notes TEXT,
                    correction_to_ai BOOLEAN DEFAULT FALSE,
                    
                    -- Embedding for RAG search
                    embedding vector(384),
                    search_text TEXT,
                    
                    -- Timestamps
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
            # Create indexes for annotations
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_annotations_session_id 
                ON ic_annotations(session_id);
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_annotations_image_path 
                ON ic_annotations(image_path);
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_annotations_embedding 
                ON ic_annotations 
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            """)
            
            conn.commit()
            print("[VectorDB] Schema initialized successfully")
            
        except Exception as e:
            if conn:
                conn.rollback()
            print(f"[VectorDB] Error initializing schema: {e}")
            traceback.print_exc()
            # Don't raise - allow app to continue without vector DB
        finally:
            if conn:
                self._return_connection(conn)
    
    def _generate_embedding(self, text: str) -> Optional[np.ndarray]:
        """Generate embedding vector for text"""
        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            print("[VectorDB] sentence-transformers not available, cannot generate embeddings")
            return None
        try:
            model = get_embedding_model()
            embedding = model.encode(text, convert_to_numpy=True)
            return embedding.tolist()  # Convert to list for PostgreSQL
        except Exception as e:
            print(f"[VectorDB] Error generating embedding: {e}")
            return None
    
    def _extract_search_text(self, metadata: Dict, analysis_data: Dict, tool_outputs: Dict) -> str:
        """Extract searchable text from analysis data"""
        text_parts = []
        
        # Add IC information
        ic_info = metadata.get('ic_info', {})
        if ic_info.get('part_number'):
            text_parts.append(f"Part number: {ic_info['part_number']}")
        if ic_info.get('manufacturer'):
            text_parts.append(f"Manufacturer: {ic_info['manufacturer']}")
        if ic_info.get('package_type'):
            text_parts.append(f"Package: {ic_info['package_type']}")
        if ic_info.get('coo'):
            text_parts.append(f"Country of origin: {ic_info['coo']}")
        
        # Add analysis summaries
        if analysis_data.get('dimension_analysis'):
            dim = analysis_data['dimension_analysis']
            if isinstance(dim, dict):
                text_parts.append(f"Dimension analysis: {json.dumps(dim)}")
        
        if analysis_data.get('visual_comparison'):
            visual = analysis_data['visual_comparison']
            if isinstance(visual, dict) and visual.get('summary'):
                text_parts.append(f"Visual analysis: {visual['summary']}")
        
        if analysis_data.get('oem_info'):
            oem = analysis_data['oem_info']
            if isinstance(oem, dict):
                text_parts.append(f"OEM information: {json.dumps(oem)}")
        
        # Add tool outputs
        if tool_outputs.get('identify'):
            text_parts.append(f"Identification: {json.dumps(tool_outputs['identify'])}")
        if tool_outputs.get('scrape'):
            text_parts.append(f"Datasheet scrape: {json.dumps(tool_outputs['scrape'])}")
        if tool_outputs.get('parse'):
            text_parts.append(f"Datasheet parse: {json.dumps(tool_outputs['parse'])}")
        
        return " ".join(text_parts)
    
    def store_analysis(self, session_id: str, metadata: Dict, analysis_data: Dict, 
                      tool_outputs: Dict) -> bool:
        """Store analysis data with vector embedding"""
        conn = None
        try:
            # Extract searchable text
            search_text = self._extract_search_text(metadata, analysis_data, tool_outputs)
            
            # Generate embedding
            embedding = self._generate_embedding(search_text)
            if embedding is None:
                print(f"[VectorDB] Warning: Could not generate embedding for session {session_id}")
                embedding = None
            
            # Extract key fields
            ic_info = metadata.get('ic_info', {})
            scores = metadata.get('scores', {})
            processed_date = metadata.get('processed_date')
            if isinstance(processed_date, str):
                processed_date = datetime.fromisoformat(processed_date.replace('Z', '+00:00'))
            elif processed_date is None:
                processed_date = datetime.now()
            
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Insert or update
            # Format embedding as PostgreSQL vector string: '[0.1, 0.2, ...]'
            embedding_str = None
            if embedding:
                embedding_str = '[' + ','.join(map(str, embedding)) + ']'
            
            cursor.execute("""
                INSERT INTO analysis_history (
                    session_id, part_number, manufacturer, package_type, pin_count,
                    country_of_origin, authenticity_score, verdict, processed_date,
                    metadata, analysis_data, tool_outputs, embedding, search_text
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s
                )
                ON CONFLICT (session_id) 
                DO UPDATE SET
                    part_number = EXCLUDED.part_number,
                    manufacturer = EXCLUDED.manufacturer,
                    package_type = EXCLUDED.package_type,
                    pin_count = EXCLUDED.pin_count,
                    country_of_origin = EXCLUDED.country_of_origin,
                    authenticity_score = EXCLUDED.authenticity_score,
                    verdict = EXCLUDED.verdict,
                    processed_date = EXCLUDED.processed_date,
                    metadata = EXCLUDED.metadata,
                    analysis_data = EXCLUDED.analysis_data,
                    tool_outputs = EXCLUDED.tool_outputs,
                    embedding = EXCLUDED.embedding,
                    search_text = EXCLUDED.search_text,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                session_id,
                ic_info.get('part_number'),
                ic_info.get('manufacturer'),
                ic_info.get('package_type'),
                ic_info.get('pin_count'),
                ic_info.get('coo'),
                scores.get('authenticity_score'),
                metadata.get('verdict', 'UNKNOWN'),
                processed_date,
                json.dumps(metadata),
                json.dumps(analysis_data),
                json.dumps(tool_outputs),
                embedding_str,
                search_text
            ))
            
            conn.commit()
            print(f"[VectorDB] Stored analysis for session {session_id}")
            return True
            
        except Exception as e:
            if conn:
                conn.rollback()
            print(f"[VectorDB] Error storing analysis: {e}")
            traceback.print_exc()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def vector_search(self, query: str, limit: int = 10, 
                     filters: Optional[Dict] = None) -> List[Dict]:
        """Search analysis history using vector similarity"""
        conn = None
        try:
            # Generate embedding for query
            query_embedding = self._generate_embedding(query)
            if query_embedding is None:
                print("[VectorDB] Could not generate query embedding, falling back to text search")
                return self.text_search(query, limit, filters)
            
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Build WHERE clause for filters
            where_clauses = []
            params = []
            
            if filters:
                if filters.get('verdict'):
                    where_clauses.append("verdict = %s")
                    params.append(filters['verdict'])
                
                if filters.get('manufacturer'):
                    where_clauses.append("manufacturer ILIKE %s")
                    params.append(f"%{filters['manufacturer']}%")
                
                if filters.get('date_from'):
                    where_clauses.append("processed_date >= %s")
                    params.append(filters['date_from'])
                
                if filters.get('date_to'):
                    where_clauses.append("processed_date <= %s")
                    params.append(filters['date_to'])
            
            where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
            
            # Format query embedding as PostgreSQL vector string
            query_embedding_str = '[' + ','.join(map(str, query_embedding)) + ']'
            
            # Vector similarity search using cosine distance
            sql = f"""
                SELECT 
                    session_id,
                    part_number,
                    manufacturer,
                    package_type,
                    pin_count,
                    country_of_origin,
                    authenticity_score,
                    verdict,
                    processed_date,
                    metadata,
                    analysis_data,
                    tool_outputs,
                    1 - (embedding <=> %s::vector) as similarity
                FROM analysis_history
                WHERE embedding IS NOT NULL {where_sql}
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """
            
            # Build params: query_embedding (for similarity calc), query_embedding (for ORDER BY), limit, then filter params
            params_final = [query_embedding_str, query_embedding_str, limit] + params
            
            cursor.execute(sql, params_final)
            results = cursor.fetchall()
            
            # Convert to list of dicts
            return [dict(row) for row in results]
            
        except Exception as e:
            print(f"[VectorDB] Error in vector search: {e}")
            traceback.print_exc()
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def text_search(self, query: str, limit: int = 10,
                   filters: Optional[Dict] = None) -> List[Dict]:
        """Full-text search using PostgreSQL text search"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Build WHERE clause
            where_clauses = ["to_tsvector('english', search_text) @@ plainto_tsquery('english', %s)"]
            params = [query]
            
            if filters:
                if filters.get('verdict'):
                    where_clauses.append("verdict = %s")
                    params.append(filters['verdict'])
                
                if filters.get('manufacturer'):
                    where_clauses.append("manufacturer ILIKE %s")
                    params.append(f"%{filters['manufacturer']}%")
            
            where_sql = " AND " + " AND ".join(where_clauses)
            
            sql = f"""
                SELECT 
                    session_id,
                    part_number,
                    manufacturer,
                    package_type,
                    pin_count,
                    country_of_origin,
                    authenticity_score,
                    verdict,
                    processed_date,
                    metadata,
                    analysis_data,
                    tool_outputs,
                    ts_rank(to_tsvector('english', search_text), plainto_tsquery('english', %s)) as rank
                FROM analysis_history
                WHERE {where_sql}
                ORDER BY rank DESC, processed_date DESC
                LIMIT %s
            """
            
            params.append(limit)
            cursor.execute(sql, params)
            results = cursor.fetchall()
            
            return [dict(row) for row in results]
            
        except Exception as e:
            print(f"[VectorDB] Error in text search: {e}")
            traceback.print_exc()
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_all(self, limit: Optional[int] = None, 
                sort_by: str = 'processed_date',
                sort_order: str = 'DESC',
                filters: Optional[Dict] = None) -> List[Dict]:
        """Get all analysis history with optional filters and sorting"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            where_clauses = []
            params = []
            
            if filters:
                if filters.get('verdict'):
                    verdict_filter = filters['verdict'].upper()
                    # Handle partial verdict matching (e.g., "SUSPICIOUS" matches "SUSPICIOUS - REQUIRES INSPECTION")
                    if verdict_filter == 'SUSPICIOUS':
                        where_clauses.append("UPPER(verdict) LIKE %s")
                        params.append('%SUSPICIOUS%')
                    elif verdict_filter == 'COUNTERFEIT':
                        where_clauses.append("UPPER(verdict) LIKE %s")
                        params.append('%COUNTERFEIT%')
                    elif verdict_filter == 'AUTHENTIC':
                        where_clauses.append("UPPER(verdict) LIKE %s")
                        params.append('%AUTHENTIC%')
                    else:
                        # Exact match for other values
                        where_clauses.append("UPPER(verdict) = %s")
                        params.append(verdict_filter)
                
                if filters.get('manufacturer'):
                    where_clauses.append("manufacturer ILIKE %s")
                    params.append(f"%{filters['manufacturer']}%")
                
                if filters.get('date_from'):
                    where_clauses.append("processed_date >= %s")
                    params.append(filters['date_from'])
                
                if filters.get('date_to'):
                    where_clauses.append("processed_date <= %s")
                    params.append(filters['date_to'])
            
            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # Validate sort_by
            valid_sort_columns = ['processed_date', 'authenticity_score', 'part_number', 'manufacturer']
            if sort_by not in valid_sort_columns:
                sort_by = 'processed_date'
            
            sort_order = 'DESC' if sort_order.upper() == 'DESC' else 'ASC'
            
            # Use parameterized query for limit too
            if limit:
                limit_sql = " LIMIT %s"
                params.append(limit)
            else:
                limit_sql = ""
            
            sql = f"""
                SELECT 
                    session_id,
                    part_number,
                    manufacturer,
                    package_type,
                    pin_count,
                    country_of_origin,
                    authenticity_score,
                    verdict,
                    processed_date,
                    metadata,
                    analysis_data,
                    tool_outputs
                FROM analysis_history
                {where_sql}
                ORDER BY {sort_by} {sort_order}
                {limit_sql}
            """
            
            cursor.execute(sql, params)
            results = cursor.fetchall()
            
            return [dict(row) for row in results]
            
        except Exception as e:
            print(f"[VectorDB] Error getting all history: {e}")
            traceback.print_exc()
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def store_annotation(self, session_id: str, annotation: Dict) -> bool:
        """Store annotation with embedding"""
        conn = None
        try:
            # Generate searchable text
            search_text_parts = []
            if annotation.get('label'):
                search_text_parts.append(f"Label: {annotation['label']}")
            if annotation.get('description'):
                search_text_parts.append(annotation['description'])
            if annotation.get('annotation_type'):
                search_text_parts.append(f"Type: {annotation['annotation_type']}")
            if annotation.get('correction_to_ai'):
                search_text_parts.append("[CORRECTS AI ANALYSIS]")
            
            search_text = " ".join(search_text_parts)
            
            # Generate embedding
            embedding = self._generate_embedding(search_text)
            
            conn = self._get_connection()
            cursor = conn.cursor()
            
            embedding_str = None
            if embedding:
                embedding_str = '[' + ','.join(map(str, embedding)) + ']'
            
            cursor.execute("""
                INSERT INTO ic_annotations (
                    session_id, image_path, annotation_id,
                    bbox_x, bbox_y, bbox_width, bbox_height,
                    label, description, annotation_type, severity,
                    verified, user_id, user_notes, correction_to_ai,
                    embedding, search_text
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s
                )
                ON CONFLICT (annotation_id) 
                DO UPDATE SET
                    label = EXCLUDED.label,
                    description = EXCLUDED.description,
                    annotation_type = EXCLUDED.annotation_type,
                    severity = EXCLUDED.severity,
                    verified = EXCLUDED.verified,
                    user_notes = EXCLUDED.user_notes,
                    correction_to_ai = EXCLUDED.correction_to_ai,
                    embedding = EXCLUDED.embedding,
                    search_text = EXCLUDED.search_text,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                session_id,
                annotation.get('image_path', ''),
                annotation.get('annotation_id'),
                annotation.get('bbox_x', 0),
                annotation.get('bbox_y', 0),
                annotation.get('bbox_width', 0),
                annotation.get('bbox_height', 0),
                annotation.get('label'),
                annotation.get('description'),
                annotation.get('annotation_type'),
                annotation.get('severity'),
                annotation.get('verified', False),
                annotation.get('user_id'),
                annotation.get('user_notes'),
                annotation.get('correction_to_ai', False),
                embedding_str,
                search_text
            ))
            
            conn.commit()
            print(f"[VectorDB] Stored annotation {annotation.get('annotation_id')}")
            return True
            
        except Exception as e:
            if conn:
                conn.rollback()
            print(f"[VectorDB] Error storing annotation: {e}")
            traceback.print_exc()
            return False
        finally:
            if conn:
                self._return_connection(conn)
    
    def get_annotations_for_session(self, session_id: str) -> List[Dict]:
        """Get all annotations for a session"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            cursor.execute("""
                SELECT * FROM ic_annotations
                WHERE session_id = %s
                ORDER BY created_at DESC
            """, (session_id,))
            
            results = cursor.fetchall()
            return [dict(row) for row in results]
            
        except Exception as e:
            print(f"[VectorDB] Error getting annotations: {e}")
            traceback.print_exc()
            return []
        finally:
            if conn:
                self._return_connection(conn)
    
    def search_annotations(self, query: str, limit: int = 10, 
                          filters: Optional[Dict] = None) -> List[Dict]:
        """Vector search across annotations"""
        conn = None
        try:
            query_embedding = self._generate_embedding(query)
            if query_embedding is None:
                return []
            
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            where_clauses = []
            params = []
            
            if filters:
                if filters.get('annotation_type'):
                    where_clauses.append("annotation_type = %s")
                    params.append(filters['annotation_type'])
                if filters.get('severity'):
                    where_clauses.append("severity = %s")
                    params.append(filters['severity'])
                if filters.get('correction_to_ai') is not None:
                    where_clauses.append("correction_to_ai = %s")
                    params.append(filters['correction_to_ai'])
            
            where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
            
            # Convert embedding to proper vector format for PostgreSQL
            query_embedding_str = '[' + ','.join(map(str, query_embedding)) + ']'
            
            sql = f"""
                SELECT 
                    *,
                    1 - (embedding <=> %s::vector) as similarity
                FROM ic_annotations
                WHERE embedding IS NOT NULL {where_sql}
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """
            
            # Build params in correct order: 
            # 1. SELECT similarity calculation (%s::vector)
            # 2. WHERE clause params (if any)
            # 3. ORDER BY (%s::vector)
            # 4. LIMIT (%s)
            params_final = [query_embedding_str] + params + [query_embedding_str, limit]
            cursor.execute(sql, params_final)
            results = cursor.fetchall()
            
            return [dict(row) for row in results]
            
        except Exception as e:
            print(f"[VectorDB] Error searching annotations: {e}")
            traceback.print_exc()
            return []
        finally:
            if conn:
                self._return_connection(conn)

# Global instance
_vector_db = None

def get_vector_db() -> Optional[VectorDB]:
    """Get or create VectorDB instance"""
    global _vector_db
    if _vector_db is None:
        try:
            _vector_db = VectorDB()
        except Exception as e:
            print(f"[VectorDB] Warning: Could not initialize VectorDB: {e}")
            print("[VectorDB] App will continue without vector search functionality")
            return None
    return _vector_db

