const express = require('express');  // express 라우팅
const multer = require('multer');
const path = require('path');
const app = express();
const port = 9070;

const mysql = require('mysql');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const SECRET_KEY = 'DiGong';
const uploads = multer({ dest: 'uploads/' }); 

connection = mysql.createConnection({
  host:'db-react-mariadb',
  user:'root',
  password:'1234',
  database:'kdt'
});

// DB연결 실패 시 에러 출력
connection.connect((err)=>{
  if(err){
    console.log('MYSQL 연결실패 : ', err);
    return;
  }
  console.log('MYSQL 연결 성공...')
})

// 교차 출처 공유 허용
const cors = require('cors');
app.use(cors());
app.use(express.json());


// 로그인
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  connection.query('SELECT * FROM p3_users WHERE email=?', [email], async (err, result) => {
    if (err || result.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호를 확인해주세요.' });
    }

    const user = result[0];

    // bcrypt 해시 비교
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: '아이디 또는 비밀번호를 확인해주세요.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, nickname: user.nickname, img: user.img, introduce: user.introduce },
      SECRET_KEY
    );
    res.json({ token });
  });
});

//회원가입
app.post('/signin', async(req, res)=>{
  const {email, password, name, nickname} = req.body;
  const hash = await bcrypt.hash(password, 10);

  connection.query('INSERT INTO p3_users (email, password, name, nickname) VALUES (?, ?, ?, ?)',[email, hash, name, nickname],
    (err, result) =>{
      if(err){
        if(err.code == 'ER_DUP_ENTRY'){
          return res.status(400).json({error:'이미 존재하는 아이디입니다.'});
        }
        return res.status(500).json({error:'회원가입 실패'});
      }
      res.json({success: true, message: '회원가입 성공' });
    }
  );
});

// 파일 저장 설정
const storage = multer.diskStorage({
  destination: function(req, file, cb){
    cb(null, 'uploads/');
  },
  filename: function(req, file, cb){
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueSuffix = Math.round(Math.random()*1E9);
    cb(null, uniqueSuffix + '_' + originalName);
  }
});

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif'];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('허용되지 않은 파일 형식입니다.'));
  }
};

const upload = multer({ storage, fileFilter });
app.use('/uploads', express.static('uploads'));

// 업로드 라우트
app.post('/upload', upload.array('files'), (req, res) => {
  if(!req.files) return res.status(400).json({ error : '파일 없음'});

  const { title, category, explain, author_id } = req.body;
  
  // DB 저장
  const postSql = 'INSERT INTO p3_posts (title, category, `explain`, author_id) VALUES (?, ?, ?, ?)';
  connection.query(postSql, [title, category, explain, author_id], (err, postRes) =>{
    if(err){
      console.error('게시글 저장 에러 : ', err);
      return res.status(500).json({ error: '게시글 저장 실패'});
    }
  
    const postId = postRes.insertId;
    const fileName = req.files.map(file => file.filename);
    const values = fileName.map(name => [postId, name]);

    const sql = 'INSERT INTO p3_post_files (post_id, file_name) VALUES ?';
    connection.query(sql, [values], (err, fileRes) => {
      if(err) {
        console.error('DB 저장 에러 : ', err);
        return res.status(500).json({ error : 'DB 저장 실패'});
      }

      res.json({ message: '파일 저장 및 DB 등록 성공', savedFiles: fileName, postId: postId});
    });
  });
});

// 에러 처리 미들웨어
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.includes('허용되지 않은 파일 형식')) {
    res.status(400).json({ error: err.message });
  } else {
    next(err);
  }
});

// 메인 목록 불러오기
app.get('/posts', (req, res) => {
  connection.query("SELECT p3_posts.*, p3_post_files.file_name AS file_name, p3_users.img FROM p3_posts LEFT JOIN (SELECT post_id, MIN(id) AS file_id FROM p3_post_files GROUP BY post_id) AS min_files ON p3_posts.id = min_files.post_id LEFT JOIN p3_post_files ON p3_post_files.id = min_files.file_id LEFT JOIN p3_users ON p3_posts.author_id = p3_users.id ORDER BY p3_posts.id DESC;", (err, results) => {
    if(err){
      console.log('쿼리문 오류 : ', err);
      res.status(500).json({error: 'DB쿼리 오류'});
      return;
    }
    res.json(results);
  })
});

// 상세 보기
app.get('/detail/:p_id', (req,res) => {
  const p_id = req.params.p_id;

  connection.query("SELECT * FROM p3_posts LEFT JOIN p3_post_files ON p3_posts.id = p3_post_files.post_id LEFT JOIN p3_users ON p3_posts.author_id = p3_users.id WHERE p3_posts.id = ?;",[p_id],
    (err, results)=>{
      if(err){
        console.log('불러오기 오류 : ', err);
        res.status(500).json({error: '작품 로딩 실패'});
        return;
      }      
      else res.json(results);
    }
  )
})

// 상세 보기 댓글 등록 및 조회
app.post('/comment', (req,res) => {
  const {p_id, u_id, detail_txtbox} = req.body;
  if(!p_id || !u_id || !detail_txtbox) return res.status(400).json({error:'필수 항목 누락'});
  connection.query("INSERT INTO p3_post_comments (post_id, user_id, comment) VALUES (?, ?, ?)",[p_id, u_id, detail_txtbox],
    (err, results) => {
      if(err){
        console.log('등록 오류 :', err);
        res.status(500).json({error: '코멘트 등록 실패'});
        return;
      } else res.json({success:true});
    }
  )
})

app.get('/comment/:p_id', (req,res) => {
  const p_id = req.params.p_id;
  connection.query("SELECT * FROM p3_post_comments LEFT JOIN p3_users ON p3_post_comments.user_id = p3_users.id WHERE post_id=? ORDER BY created_at DESC;", [p_id], (err, results) =>{
    if(err){ 
      console.log('쿼리문 오류 : ', err);
      res.status(500).json({error: 'DB쿼리 오류'});
      return;
    }
    else res.json(results);
  })
});

//프로필 업로드 가져오기
app.get('/user-posts', async (req, res) => {
    const authorId = Number(req.query.author_id);
    if (!authorId) {
        return res.status(400).json({ error: 'author_id가 유효하지 않습니다.' });
    }
    
    connection.query(
      'SELECT p3_posts.*, p3_post_files.file_name AS file_name, p3_users.img, p3_users.email, p3_users.nickname FROM p3_posts LEFT JOIN (SELECT post_id, MIN(id) AS file_id FROM p3_post_files GROUP BY post_id) AS min_files ON p3_posts.id = min_files.post_id LEFT JOIN p3_post_files ON p3_post_files.id = min_files.file_id LEFT JOIN p3_users ON p3_posts.author_id = p3_users.id WHERE p3_posts.author_id = ? ORDER BY p3_posts.id DESC;', [authorId], 
    (err, results) => {
      if(err) {
        console.error('/profile 에러: ', err);
        return res.status(500).json({error: '서버 오류 발생'});
      }
      res.json(results);
    })
});

// 프로필 사진 업데이트
const profileUpload = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb){
      cb(null, 'uploads/');
    },
    filename: function(req, file, cb){
      const userId = req.body.userId;
      if (!userId) return cb(new Error('userId가 필요합니다.'));

      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `profile_${userId}${ext}`);
    }
  }),
  fileFilter
});

const fs = require('fs');
const { connect } = require('http2');

app.post('/upload-profile-img', profileUpload.single('image'), (req, res) => {
  const userId = req.body.userId;
  const file = req.file;

  if (!userId || !file) {
    return res.status(400).json({ error: 'userId 또는 파일이 누락되었습니다.' });
  }

  const newFilename = file.filename;
  const newExt = path.extname(newFilename).toLowerCase();

  // 1. 기존 이미지 파일명 가져오기
  const getOldSql = 'SELECT img FROM p3_users WHERE id = ?';
  connection.query(getOldSql, [userId], (err, result) => {
    if (err) {
      console.error('기존 이미지 조회 실패:', err);
      return res.status(500).json({ error: 'DB 조회 실패' });
    }

    const oldFilename = result[0]?.img;

    // 2. 기존 파일이 있고 확장자가 다르면 삭제
    if (oldFilename !== 'user.png') {
      const oldExt = path.extname(oldFilename).toLowerCase();

      if (oldExt !== newExt) {
        const oldPath = path.join(__dirname, 'uploads', oldFilename);
        fs.unlink(oldPath, (err) => {
          if (err) console.warn('기존 파일 삭제 실패:', err.message);
          else console.log('기존 파일 삭제됨:', oldFilename);
        });
      }
    }

    // 3. DB 업데이트
    const updateSql = 'UPDATE p3_users SET img = ? WHERE id = ?';
    connection.query(updateSql, [newFilename, userId], (err, result) => {
      if (err) {
        console.error('DB 업데이트 실패:', err);
        return res.status(500).json({ error: 'DB 업데이트 실패' });
      }

      res.json({ success: true, filename: newFilename, path: `/uploads/${newFilename}` });
    });
  });
});

//프로필 페이지에서 작품 삭제
app.delete('/profile/:id', (req, res) => {
  const id = req.params.id;

  // 1. 먼저 파일 삭제
  const deleteFilesQuery = `DELETE FROM p3_post_files WHERE post_id = ?`;
  connection.query(deleteFilesQuery, [id], (fileErr) => {
    if (fileErr) {
      console.error('파일 삭제 실패:', fileErr);
      return res.status(500).json({ message: '첨부파일 삭제 중 오류 발생' });
    }

    // 2. 코엔트 삭제
    const deleteComment = `DELETE FROM p3_post_comments WHERE post_id = ?`;
    connection.query(deleteComment, [id], (commErr, commRes) => {
      if(commErr){
        console.error('코멘트 삭제 실패:', commErr);
        return res.status(500).json({ message: '코멘트 삭제 중 오류'})
      }
    });

    // 3. 다음 게시글 삭제
    const deletePostQuery = `DELETE FROM p3_posts WHERE id = ?`;
    connection.query(deletePostQuery, [id], (postErr, result) => {
      if (postErr) {
        console.error('게시글 삭제 실패:', postErr);
        return res.status(500).json({ message: '게시글 삭제 중 오류 발생' });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: '해당 게시글이 존재하지 않습니다.' });
      }

      res.json({ message: '게시글이 성공적으로 삭제되었습니다.' });
    });
  });
});

//프로필 페이지에서 작품 수정
app.get('/profile/:id', (req, res) => {
  const id = req.params.id;

  const query = `
    SELECT 
      p3_posts.*, 
      p3_post_files.file_name 
    FROM 
      p3_posts
    LEFT JOIN (
      SELECT post_id, MIN(id) AS file_id 
      FROM p3_post_files 
      GROUP BY post_id
    ) AS min_files ON p3_posts.id = min_files.post_id
    LEFT JOIN p3_post_files ON p3_post_files.id = min_files.file_id
    WHERE p3_posts.id = ?;
  `;

  connection.query(query, [id], (err, results) => {
    if (err) {
      console.error('/profile/:id 에러:', err);
      return res.status(500).json({ error: '서버 오류 발생' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다' });
    }

    res.json(results[0]); // 단일 게시글만 반환
  });
});

//작품 수정 업데이트
app.post('/update-post/:id', upload.array('files', 5), (req, res) => {
  const id = req.params.id;
  const { title, category, explain } = req.body;
  const files = req.files;

  console.log('요청 id:', id);
  console.log('요청 내용:', title, category, explain);
  console.log('업로드된 파일들:', files);

  // 게시글 먼저 업데이트
  const updatePostQuery = `UPDATE p3_posts SET title = ?, category = ?, \`explain\` = ? WHERE id = ?`;
  connection.query(updatePostQuery, [title, category, explain, id], (postErr, postRes) => {
    if (postErr) {
      console.error('게시글 업데이트 실패:', postErr);
      return res.status(500).json({ error: '게시글 업데이트 중 오류 발생' });
    }

    // 파일이 있는 경우만 추가 처리
    if (files && files.length > 0) {
      const deleteFilesQuery = `DELETE FROM p3_post_files WHERE post_id = ?`;
      connection.query(deleteFilesQuery, [id], (deleteErr) => {
        if (deleteErr) {
          console.error('기존 파일 삭제 실패:', deleteErr);
          return res.status(500).json({ error: '기존 파일 삭제 중 오류 발생' });
        }

        // 새 파일 삽입
        const insertFileQuery = `INSERT INTO p3_post_files (post_id, file_name) VALUES ?`;
        const values = files.map(file => [id, file.filename]);

        connection.query(insertFileQuery, [values], (insertErr) => {
          if (insertErr) {
            console.error('파일 저장 실패:', insertErr);
            return res.status(500).json({ error: '파일 저장 중 오류 발생' });
          }

          res.json({ success: true, message: '게시글 및 이미지 수정 완료 (기존 이미지 삭제 후 재업로드)' });
        });
      });
    } else {
      // 파일 없이 게시글만 수정
      res.json({ success: true, message: '게시글 수정 완료 (이미지 없음)' });
    }
  });
});

//좋아요 추가
app.post('/like',(req, res)=>{
  const {user_id, post_id} = req.body;
  const sql = 'INSERT INTO p3_post_likes (user_id, post_id) VALUES (?, ?)';
  connection.query(sql, [user_id, post_id], (err)=>{
    if(err) return res.status(500).json({error: '좋아요 실패'});
    res.json({success: true});
  });
});

//좋아요 삭제
app.delete('/like', (req, res)=>{
  const {user_id, post_id} = req.body;
  const sql = 'DELETE FROM p3_post_likes WHERE user_id = ? AND post_id = ?';
  connection.query(sql, [user_id, post_id], (err)=>{
    if(err) return res.status(500).json({error: '좋아요 취소 실패'});
      res.json({success: true});
  });
});

//좋아요 게시물 가져오기
app.get('/liked-posts/:user_id', (req, res) => {
  const userId = req.params.user_id;
  const sql = `
    SELECT p.*, f.file_name, u.img 
    FROM p3_post_likes l 
    JOIN p3_posts p ON l.post_id = p.id 
    LEFT JOIN (
      SELECT post_id, MIN(id) AS file_id FROM p3_post_files GROUP BY post_id
    ) AS mf ON p.id = mf.post_id 
    LEFT JOIN p3_post_files f ON mf.file_id = f.id 
    LEFT JOIN p3_users u ON p.author_id = u.id 
    WHERE l.user_id = ?
  `;
  connection.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('좋아요 목록 쿼리 실패:', err);
      return res.status(500).json({ error: '좋아요 목록 로딩 실패' });
    }
    res.json(results);
  });
});

//유저 정보 불러오기
app.get('/profileupdate/:id', (req, res) => {
  const userId = req.params.id;

  const sql = `
    SELECT id, name, email, nickname, introduce
    FROM p3_users
    WHERE id = ?;
  `;

  connection.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('유저 정보 불러오기 실패:', err);
      return res.status(500).json({ error: '서버 오류' });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    }
    res.json(results[0]);
  });
});

// 유저 정보 수정
app.put('/profileupdate/:id', (req, res) => {
  const userId = req.params.id;
  const { name, nickname, introduce } = req.body;

  const sql = `
    UPDATE p3_users
    SET name = ?, nickname = ?, introduce = ?
    WHERE id = ?;
  `;

  connection.query(sql, [name, nickname, introduce, userId], (err, results) => {
    if (err) {
      console.error('유저 정보 수정 실패:', err);
      return res.status(500).json({ error: '서버 오류' });
    }
    res.json({ message: '유저 정보가 성공적으로 수정되었습니다.' });
  });
});


app.listen(port, ()=> {
  console.log('Listening...');
});

// app.get('/', (req, res)=>{
//   res.json('Excused from Backend');
// })