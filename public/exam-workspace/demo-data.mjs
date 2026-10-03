// Public, hand-authored sample questions. Never use this client-side answer shape for a real exam.
export const DEMO_COURSE = { id: 'demo-data-structures', name: '자료구조', label: '체험 과목' };
export const DEMO_QUESTIONS = [
  { id: 'demo-q1', concept: '스택과 큐', difficulty: 1, body: '가장 나중에 들어온 데이터를 가장 먼저 꺼내는 자료구조는 무엇일까요?', choices: ['큐 (Queue)', '스택 (Stack)', '힙 (Heap)', '배열 (Array)'], answerIndex: 1, explanation: '스택은 LIFO(Last In, First Out) 순서로 데이터를 꺼냅니다.' },
  { id: 'demo-q2', concept: '스택과 큐', difficulty: 1, body: '먼저 들어온 데이터가 먼저 나가는 큐의 처리 방식을 고르세요.', choices: ['LIFO', '무작위 접근', 'FIFO', '이진 탐색'], answerIndex: 2, explanation: '큐는 FIFO(First In, First Out) 순서로 데이터를 처리합니다.' },
  { id: 'demo-q3', concept: '시간 복잡도', difficulty: 2, body: '길이가 n인 정렬된 배열에서 이진 탐색의 최악 시간 복잡도는 무엇일까요?', choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answerIndex: 1, explanation: '비교할 때마다 탐색 범위를 절반으로 줄이므로 최악 시간 복잡도는 O(log n)입니다.' },
  { id: 'demo-q4', concept: '배열과 연결 리스트', difficulty: 1, body: '연속 메모리에 저장된 배열에서 인덱스로 원소 하나에 접근할 때의 시간 복잡도는 무엇일까요?', choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], answerIndex: 0, explanation: '시작 주소와 인덱스로 원소의 위치를 직접 계산하므로 O(1)입니다.' },
  { id: 'demo-q5', concept: '트리와 그래프', difficulty: 2, body: '간선의 가중치가 모두 같은 그래프에서 시작 정점으로부터 최단 거리 탐색에 알맞은 방법은 무엇일까요?', choices: ['깊이 우선 탐색 (DFS)', '너비 우선 탐색 (BFS)', '선택 정렬', '이진 탐색'], answerIndex: 1, explanation: 'BFS는 시작 정점에서 가까운 정점부터 차례로 방문합니다.' },
  { id: 'demo-q6', concept: '배열과 연결 리스트', difficulty: 2, body: '단일 연결 리스트에서 첫 번째 노드를 삭제할 때, 헤드 포인터만 가지고 있다면 시간 복잡도는 무엇일까요?', choices: ['O(n²)', 'O(n)', 'O(log n)', 'O(1)'], answerIndex: 3, explanation: '헤드 포인터를 다음 노드로 바꾸면 되므로 O(1)입니다.' },
  { id: 'demo-q7', concept: '트리와 그래프', difficulty: 3, body: '정점이 n개인 연결된 무방향 트리의 간선 수는 얼마일까요? (n ≥ 1)', choices: ['n − 1', 'n', 'n + 1', '2n'], answerIndex: 0, explanation: '트리는 연결되어 있고 사이클이 없으므로 간선 수는 정점 수보다 하나 적습니다.' },
  { id: 'demo-q8', concept: '시간 복잡도', difficulty: 3, body: '서로 중첩된 두 반복문이 각각 n번 실행된다면 전체 실행 횟수의 증가율은 무엇일까요?', choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answerIndex: 3, explanation: '바깥 반복 n번마다 안쪽 반복이 n번 실행되어 총 n²번 실행됩니다.' },
].map((q) => ({ ...q, courseId: DEMO_COURSE.id, qtype: 'choice', source: '직접 작성한 체험 문항' }));
